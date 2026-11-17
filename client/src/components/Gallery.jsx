import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, ArrowUpDown, Check, CheckCircle2, CheckSquare, ChevronRight, Ellipsis, EyeOff, Filter, Folder,
  FolderInput, Grid2X2, Grid3X3, Heart, HelpCircle, Image as ImageIcon, Keyboard, LayoutGrid, List,
  MessageSquare, RotateCcw, Search, Send, Sparkles, Square, Tag, X,
} from 'lucide-react';
import { PhotoCard } from './PhotoCard.jsx';
import { photoImageUrl } from '../api.js';
import { countGridColumns, gridKeyAction, isTypingTarget, nextGridIndex } from '../gridKeyboard.js';
import { findBurstNeighbor } from '../photoBurst.js';

const SHORTCUTS = [
  ['← → ↑ ↓', 'Di chuyển giữa các ảnh'],
  ['1 · 2 · 3', 'Giữ lại · Cân nhắc · Bỏ qua'],
  ['0', 'Xoá đánh giá'],
  ['F', 'Yêu thích'],
  ['V', 'Đã xem / chưa xem'],
  ['Space', 'Chọn ảnh'],
  ['Shift + mũi tên', 'Chọn thêm theo hướng'],
  ['Enter', 'Mở ảnh lớn'],
  ['Esc', 'Bỏ chọn'],
  ['?', 'Hiện bảng phím tắt'],
];

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ALBUM_ICONS = {
  gate: '🚪',
  album: '📖',
  table: '🖼️',
  slide: '📽️',
};

const VIEW_MODES = [
  { id: 'grid-lg', label: 'Lưới lớn', icon: Grid2X2 },
  { id: 'grid-md', label: 'Lưới vừa', icon: LayoutGrid },
  { id: 'grid-sm', label: 'Lưới nhỏ', icon: Grid3X3 },
  { id: 'list', label: 'Danh sách chi tiết', icon: List },
];

// Actions for the selected photos, floating at the bottom of the gallery.
function SelectionBar({
  count, albums, filter, virtualAlbums, isBatchAlbumPending, canCompare, selectedTriage = null, hasTriage = false,
  onSetTriage, onAddToAlbum, onRemoveFromAlbum, onMove, onCompare, onMarkViewed, onMarkUnviewed, onExport, onClear,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = event => { if (!moreRef.current?.contains(event.target)) setMoreOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [moreOpen]);

  const runMore = action => { setMoreOpen(false); action(); };
  const currentAlbum = filter.startsWith('album:') ? virtualAlbums[filter.slice(6)] : null;
  const menuItem = 'flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-stone-200 hover:bg-white/5 disabled:opacity-50';
  const divider = <span className="mx-0.5 hidden h-6 w-px shrink-0 bg-stone-700 sm:block" aria-hidden="true" />;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-5">
      <div role="toolbar" aria-label="Thao tác với ảnh đã chọn" className="selection-bar">
        <span className="whitespace-nowrap px-1.5 text-xs font-semibold text-stone-100">
          Đã chọn <span className="text-studio-accent-text">{count}</span> ảnh
        </span>
        {divider}
        {onSetTriage && (
          <>
            {[
              { status: 'pick', label: 'Giữ lại', key: 1, icon: Check, tone: 'text-emerald-300' },
              { status: 'maybe', label: 'Cân nhắc', key: 2, icon: HelpCircle, tone: 'text-amber-300' },
              { status: 'reject', label: 'Bỏ qua', key: 3, icon: X, tone: 'text-stone-400' },
            ].map(({ status, label, key, icon: Icon, tone }) => {
              const active = selectedTriage === status;
              return (
                <button key={status} type="button" onClick={() => onSetTriage(active ? null : status)}
                  aria-pressed={active}
                  className={`selection-button ${active ? '!bg-white/15 ring-1 ring-white/30' : ''}`}
                  title={active ? `Tất cả ảnh đã chọn đang “${label}” — bấm để bỏ` : `${label} (phím ${key})`}>
                  <Icon className={`h-3.5 w-3.5 ${tone}`} aria-hidden="true" /> {label}
                </button>
              );
            })}
            {hasTriage && (
              <button type="button" onClick={() => onSetTriage(null)} className="selection-button" title="Xoá đánh giá của các ảnh đã chọn (phím 0)">
                <RotateCcw className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" /> Bỏ đánh giá
              </button>
            )}
            {divider}
          </>
        )}
        {albums.length > 0 && onAddToAlbum && (
          <label className="selection-button cursor-pointer">
            <Tag className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
            <select
              aria-label="Gán ảnh đã chọn vào album"
              value=""
              disabled={isBatchAlbumPending}
              onChange={event => onAddToAlbum(event.target.value)}
              className="max-w-[8.5rem] cursor-pointer bg-transparent text-inherit"
            >
              <option value="" disabled>{isBatchAlbumPending ? 'Đang gán…' : 'Gán album'}</option>
              {albums.map(album => <option key={album.id} value={album.id}>{album.name}</option>)}
            </select>
          </label>
        )}
        {currentAlbum && onRemoveFromAlbum && (
          <button type="button" disabled={isBatchAlbumPending} onClick={onRemoveFromAlbum} className="selection-button" title={`Gỡ khỏi ${currentAlbum.name}`}>
            <X className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" /> Gỡ khỏi album
          </button>
        )}
        <button type="button" onClick={onMove} className="studio-primary">
          <FolderInput className="h-3.5 w-3.5" aria-hidden="true" /> Chuyển thư mục
        </button>
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen(open => !open)}
            className="studio-icon"
            aria-label="Thao tác khác"
            aria-expanded={moreOpen}
            title="Thao tác khác"
          >
            <Ellipsis className="h-4 w-4" />
          </button>
          {moreOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-2 w-52 space-y-0.5 rounded-xl sm:left-auto sm:right-0 border border-studio-line bg-[var(--studio-panel)] p-1.5 shadow-xl">
              {canCompare && (
                <button type="button" onClick={() => runMore(onCompare)} className={menuItem}>
                  <ArrowLeftRight className="h-4 w-4 text-stone-400" aria-hidden="true" />
                  {count === 2 ? 'So sánh 2 ảnh' : 'So sánh ảnh'}
                </button>
              )}
              <button type="button" onClick={() => runMore(onMarkViewed)} className={menuItem}>
                <CheckCircle2 className="h-4 w-4 text-stone-400" aria-hidden="true" /> Đánh dấu đã xem
              </button>
              <button type="button" onClick={() => runMore(onMarkUnviewed)} className={menuItem}>
                <EyeOff className="h-4 w-4 text-stone-400" aria-hidden="true" /> Đánh dấu chưa xem
              </button>
              <button type="button" onClick={() => runMore(onExport)} className={menuItem}>
                <Send className="h-4 w-4 text-stone-400" aria-hidden="true" /> Xuất cho studio
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={onClear} className="studio-icon" aria-label="Bỏ chọn" title="Bỏ chọn (Esc)">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Gallery({
  currentFolder,
  onSelectFolder,
  onOpenSettings,
  onGenerateSamples,
  isLoading,
  photos,
  collectionPhotos,
  displayedPhotos,
  totalCount,
  viewedCount,
  favoriteCount,
  pickedCount = 0,
  maybeCount = 0,
  rejectedCount = 0,
  unassignedPickCount = 0,
  notedCount = 0,
  burstCount = 0,
  filter,
  onChangeFilter,
  sort,
  onChangeSort,
  searchQuery,
  onChangeSearch,
  selectedFiles,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onOpenLightbox,
  onToggleViewed,
  onToggleFavorite,
  onBatchViewed,
  onAddSelectedToAlbum,
  onRemoveSelectedFromAlbum,
  isBatchAlbumPending = false,
  onSetTriage,
  virtualAlbums = {},
  onOpenMoveModal,
  onOpenRangeGroup,
  onOpenCompare,
  onOpenExportModal,
  onOpenQuotaModal,
  scrollContainerRef,
  resumeAction,
  cursorPath = null,
  onCursorChange,
  keyboardEnabled = true,
}) {
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('wedding_gallery_view_mode') || 'grid-md';
  });
  const scroller = useRef(null);
  const photoObserver = useRef(null);
  const photoVisibilityCallbacks = useRef(new Map());

  const setScrollContainer = useCallback(node => {
    scroller.current = node;
    if (typeof scrollContainerRef === 'function') scrollContainerRef(node);
    else if (scrollContainerRef) scrollContainerRef.current = node;
  }, [scrollContainerRef]);

  useLayoutEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const callbacks = photoVisibilityCallbacks.current;
    const observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        callbacks.get(target)?.(isIntersecting);
      }
    }, { root: scroller.current, rootMargin: '320px 0px' });
    photoObserver.current = observer;
    return () => {
      photoObserver.current = null;
      observer.disconnect();
    };
  }, []);

  const observePhoto = useCallback((node, onVisibilityChange) => {
    const observer = photoObserver.current;
    if (!observer) return;
    const callbacks = photoVisibilityCallbacks.current;
    callbacks.set(node, onVisibilityChange);
    observer.observe(node);
    return () => {
      observer.unobserve(node);
      callbacks.delete(node);
    };
  }, []);

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('wedding_gallery_view_mode', mode);
  };

  const selectedPaths = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const isAllSelected = displayedPhotos.length > 0 && displayedPhotos.every(p => selectedPaths.has(p.relPath));
  const unviewedCount = totalCount - viewedCount;

  // Shared rating of the selected photos (null when mixed), so the bar can toggle it off.
  const { selectedTriage, selectedHasTriage } = useMemo(() => {
    if (!selectedFiles.length) return { selectedTriage: null, selectedHasTriage: false };
    const byPath = new Map();
    for (const list of [collectionPhotos || [], photos || [], displayedPhotos || []]) {
      for (const p of list) byPath.set(p.relPath, p.triage || null);
    }
    const statuses = selectedFiles.map(path => byPath.get(path) ?? null);
    const first = statuses[0];
    return {
      selectedTriage: first && statuses.every(s => s === first) ? first : null,
      selectedHasTriage: statuses.some(Boolean),
    };
  }, [selectedFiles, collectionPhotos, photos, displayedPhotos]);
  const handleCompareSelected = () => {
    if (!onOpenCompare) return;
    if (selectedFiles.length >= 1) {
      const lookup = path =>
        displayedPhotos.find(p => p.relPath === path) ||
        photos.find(p => p.relPath === path) ||
        collectionPhotos.find(p => p.relPath === path);
      const selectedPhotos = selectedFiles.map(lookup).filter(Boolean);
      const pA = selectedPhotos[0] || displayedPhotos[0] || photos[0] || null;
      const pB = selectedPhotos[1] || null;
      onOpenCompare(pA, pB);
      return;
    }
    if (displayedPhotos.length >= 2) {
      onOpenCompare(displayedPhotos[0], displayedPhotos[1]);
    }
  };

  const folderParts = currentFolder ? currentFolder.split('/') : [];
  const folderName = folderParts.at(-1) || 'Tất cả ảnh';
  const progress = totalCount ? Math.round((viewedCount / totalCount) * 100) : 0;
  const hasSearch = Boolean(searchQuery.trim());

  const primaryFilters = [
    { id: 'all', label: 'Tất cả', count: totalCount },
    { id: 'pick', label: 'Giữ lại', count: pickedCount, icon: Check, color: 'text-emerald-300' },
    { id: 'maybe', label: 'Cân nhắc', count: maybeCount, icon: HelpCircle, color: 'text-amber-300' },
    { id: 'reject', label: 'Bỏ qua', count: rejectedCount, icon: X, color: 'text-stone-400' },
    { id: 'favorite', label: 'Yêu thích', count: favoriteCount, icon: Heart, color: 'text-red-400' },
  ];
  const secondaryFilters = [
    { id: 'unviewed', label: 'Chưa xem', count: unviewedCount },
    { id: 'viewed', label: 'Đã xem', count: viewedCount },
    { id: 'unassigned', label: 'Chưa gán album', count: unassignedPickCount },
    { id: 'noted', label: 'Có ghi chú', count: notedCount },
    { id: 'burst', label: 'Chụp liên tiếp', count: burstCount },
  ];
  const secondaryFilter = secondaryFilters.find(item => item.id === filter);
  const albums = Object.values(virtualAlbums);
  const activeAlbum = filter.startsWith('album:') ? virtualAlbums[filter.slice(6)] : null;

  const toggleSelectAll = () => {
    if (isAllSelected) onDeselectAll();
    else onSelectAll(displayedPhotos.map(photo => photo.relPath));
  };

  // ---- Keyboard control of the grid (desktop) --------------------------------
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef(null);
  const helpButtonRef = useRef(null);
  const cursorIndex = cursorPath ? displayedPhotos.findIndex(photo => photo.relPath === cursorPath) : -1;
  const keyState = useRef({});
  keyState.current = {
    keyboardEnabled, displayedPhotos, cursorIndex, viewMode, selectedPaths,
    onCursorChange, onToggleSelect, onSetTriage, onToggleFavorite, onToggleViewed, onOpenLightbox, helpOpen,
    onOpenCompare, selectedFiles, photos, collectionPhotos,
  };

  // Stable handlers for the memoized PhotoCards; each reads the latest props from keyState.
  const cardActions = useMemo(() => {
    const latest = () => keyState.current;
    return {
      open: (event, relPath) => {
        if (event.shiftKey) latest().onToggleSelect(relPath, true);
        else latest().onOpenLightbox(relPath);
      },
      toggleSelect: (relPath, extendRange) => {
        latest().onCursorChange?.(relPath);
        latest().onToggleSelect(relPath, extendRange);
      },
      toggleViewed: (relPath, viewed) => latest().onToggleViewed(relPath, viewed),
      toggleFavorite: (relPath, favorite) => latest().onToggleFavorite(relPath, favorite),
      setTriage: (files, status) => latest().onSetTriage?.(files, status),
      compareBurst: photo => {
        const { onOpenCompare: openCompare, photos: visible, collectionPhotos: collection } = latest();
        openCompare?.(photo, findBurstNeighbor(photo, visible, collection));
      },
      dragFiles: (relPath, isSelected) => {
        const { selectedFiles: selected } = latest();
        return isSelected && selected.length > 0 ? selected : [relPath];
      },
    };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const close = event => {
      if (!helpRef.current?.contains(event.target) && !helpButtonRef.current?.contains(event.target)) setHelpOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [helpOpen]);

  useEffect(() => {
    const scrollCursorIntoView = path => requestAnimationFrame(() => {
      const card = scroller.current?.querySelector(`[data-photo-path="${CSS.escape(path)}"]`);
      card?.scrollIntoView({ block: 'nearest' });
    });
    // Capture phase: runs before the app's Esc-clears-selection listener.
    const handleKey = event => {
      const state = keyState.current;
      if (state.helpOpen && event.key === 'Escape') {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (!state.keyboardEnabled || event.defaultPrevented || isTypingTarget(event.target)) return;
      const action = gridKeyAction(event);
      if (!action) return;
      const onControl = event.target?.closest?.('button, a, [role="button"], summary');
      if (onControl && (action.type === 'select' || action.type === 'open')) return;
      const photos = state.displayedPhotos;
      if (action.type === 'help') {
        event.preventDefault();
        setHelpOpen(open => !open);
        return;
      }
      if (!photos.length) return;

      if (action.type === 'move' || action.type === 'extend') {
        const columns = state.viewMode === 'list'
          ? 1
          : countGridColumns([...(scroller.current?.querySelectorAll('.gallery-grid > [data-photo-path]') || [])]);
        const nextIndex = nextGridIndex(state.cursorIndex, action.key, photos.length, columns);
        if (nextIndex == null) return;
        event.preventDefault();
        const next = photos[nextIndex].relPath;
        if (action.type === 'extend') {
          const current = photos[state.cursorIndex]?.relPath;
          if (current && !state.selectedPaths.has(current)) state.onToggleSelect(current);
          state.onToggleSelect(next, Boolean(current));
        }
        state.onCursorChange?.(next);
        scrollCursorIntoView(next);
        return;
      }

      const photo = photos[state.cursorIndex];
      if (!photo) return;
      event.preventDefault();
      if (action.type === 'select') state.onToggleSelect(photo.relPath);
      else if (action.type === 'open') state.onOpenLightbox(photo.relPath);
      else if (action.type === 'favorite') state.onToggleFavorite(photo.relPath, !photo.isFavorite);
      else if (action.type === 'viewed') state.onToggleViewed(photo.relPath, !photo.isViewed);
      else if (action.type === 'triage' && state.onSetTriage) {
        const status = action.status && photo.triage === action.status ? null : action.status;
        state.onSetTriage([photo.relPath], status);
        // Same preference as the Lightbox: move on after rating a photo.
        let autoAdvance = true;
        try { autoAdvance = localStorage.getItem('wedding_auto_advance') !== 'false'; } catch { /* ignore */ }
        if (status && autoAdvance && state.cursorIndex < photos.length - 1) {
          const next = photos[state.cursorIndex + 1].relPath;
          state.onCursorChange?.(next);
          scrollCursorIntoView(next);
        }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, []);

  // ---- Header collapses while scrolling the photos -----------------------------
  const [compact, setCompact] = useState(false);
  const handleScroll = event => {
    const el = event.currentTarget;
    const room = el.scrollHeight - el.clientHeight;
    // Hysteresis so the header doesn't flicker at the threshold.
    setCompact(isCompact => (isCompact ? el.scrollTop > 8 : el.scrollTop > 96 && room > 320));
  };

  const handlePhotoClick = cardActions.open;

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="gallery-controls relative" data-compact={compact}>
        <div className="gallery-expanded-only grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 sm:flex sm:gap-5">
          <div className="min-w-0 sm:flex-1">
            <nav aria-label="Đường dẫn thư mục" className="mb-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[11px] font-medium text-stone-400 sm:text-xs">
              {folderParts.length === 0 ? (
                <span className="uppercase tracking-[0.16em]">Thư viện ảnh</span>
              ) : (
                <>
                  <button type="button" onClick={() => onSelectFolder('')} className="rounded px-0.5 hover:text-white">Thư viện ảnh</button>
                  {folderParts.slice(0, -1).map((part, index) => {
                    const path = folderParts.slice(0, index + 1).join('/');
                    return (
                      <React.Fragment key={path}>
                        <ChevronRight className="h-3 w-3 shrink-0" />
                        <button type="button" onClick={() => onSelectFolder(path)} className="rounded px-0.5 hover:text-white">{part}</button>
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            </nav>
            <h1 className="gallery-title" title={folderName}>{folderName}</h1>
          </div>
          <div className="w-[6.5rem] shrink-0 pb-1 sm:order-2 sm:w-44">
            <div className="mb-1 flex items-center justify-between gap-1 text-[11px] text-stone-400 sm:text-xs">
              <span className="whitespace-nowrap">Đã xem</span>
              <span className="whitespace-nowrap font-mono tabular-nums text-stone-200">{viewedCount}/{totalCount}</span>
            </div>
            <div
              role="progressbar"
              aria-label="Tiến độ xem ảnh"
              aria-valuenow={progress}
              aria-valuetext={`${viewedCount} trên ${totalCount} ảnh đã xem`}
              className="h-1.5 overflow-hidden rounded-full bg-stone-800"
            >
              <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
          {resumeAction && <div className="col-span-2 sm:order-1">{resumeAction}</div>}
        </div>

        <label className="gallery-control w-full sm:hidden">
          <Filter className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
          <select
            aria-label="Lọc ảnh"
            value={filter}
            onChange={e => onChangeFilter(e.target.value)}
            className="w-full min-w-0 cursor-pointer bg-transparent text-inherit"
          >
            {[...primaryFilters, ...secondaryFilters].map(({ id, label, count }) => (
              <option key={id} value={id}>{label} ({count})</option>
            ))}
            {albums.length > 0 && (
              <optgroup label="Album">
                {albums.map(album => (
                  <option key={album.id} value={`album:${album.id}`}>{album.name} ({album.photos?.length || 0})</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="gallery-compact-only min-w-0 max-w-[14rem] shrink truncate rounded px-1 text-left font-serif text-lg font-semibold text-stone-50 hover:text-studio-accent-text"
            title="Lên đầu trang"
          >
            {folderName}
          </button>
          <div className="gallery-scroll-row hidden !p-0 sm:flex">
            <div role="group" aria-label="Lọc ảnh" className="gallery-segment">
              {primaryFilters.map(({ id, label, count, icon: Icon, color }) => (
                <button key={id} type="button" onClick={() => onChangeFilter(id)} aria-pressed={filter === id} className="whitespace-nowrap">
                  {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${filter === id ? '' : color}`} aria-hidden="true" />}
                  {label}
                  <span className="gallery-filter-count">{count}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="gallery-control hidden sm:inline-flex" data-active={Boolean(secondaryFilter || activeAlbum)}>
            <Filter className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
            <select
              aria-label="Bộ lọc khác"
              value={secondaryFilter?.id || (activeAlbum ? filter : '')}
              onChange={e => onChangeFilter(e.target.value || 'all')}
              className="min-w-0 cursor-pointer bg-transparent text-inherit"
            >
              <option value="">Bộ lọc khác</option>
              {secondaryFilters.map(({ id, label, count }) => (
                <option key={id} value={id}>{label} ({count})</option>
              ))}
              {activeAlbum && <option value={filter}>Album: {activeAlbum.name}</option>}
            </select>
          </label>
          <div className="relative min-w-[8rem] flex-1 sm:ml-auto sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Tìm ảnh"
              value={searchQuery}
              onChange={e => onChangeSearch(e.target.value)}
              placeholder="Tìm theo tên ảnh…"
              className="gallery-control w-full pl-9 pr-8 placeholder:text-stone-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onChangeSearch('')}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-stone-400 hover:bg-white/5 hover:text-white"
                aria-label="Xóa tìm kiếm"
                title="Xóa tìm kiếm"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

        </div>

        <div className="gallery-expanded-only flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={displayedPhotos.length === 0}
            className="gallery-control disabled:opacity-50"
            aria-pressed={isAllSelected}
            aria-label={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            title={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          >
            {isAllSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-stone-400" />}
            <span className="hidden sm:inline">{isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
          </button>

          {onOpenRangeGroup && (
            <button
              type="button"
              onClick={onOpenRangeGroup}
              disabled={displayedPhotos.length === 0}
              className="gallery-control disabled:opacity-50"
              title="Chọn ảnh bắt đầu và ảnh kết thúc để gom vào một thư mục"
              aria-label="Gom từ ảnh đến ảnh"
            >
              <FolderInput className="h-4 w-4 text-stone-400" />
              <span className="hidden sm:inline">Gom từ ảnh → đến ảnh</span>
            </button>
          )}

          {onOpenCompare && displayedPhotos.length >= 2 && (
            <button
              type="button"
              onClick={handleCompareSelected}
              className="gallery-control"
              title="Mở bảng so sánh và tự chọn 2 ảnh bất kỳ"
              aria-label="So sánh ảnh"
            >
              <ArrowLeftRight className="h-4 w-4 text-stone-400" />
              <span className="hidden sm:inline">So sánh</span>
            </button>
          )}

          <div ref={helpButtonRef} className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setHelpOpen(open => !open)}
              aria-expanded={helpOpen}
              className="gallery-control"
              title="Phím tắt trên lưới ảnh (?)"
            >
              <Keyboard className="h-4 w-4 text-stone-400" aria-hidden="true" />
              Phím tắt
            </button>
          </div>

          <label className="gallery-control min-w-[8.5rem] flex-1 sm:ml-auto sm:max-w-none sm:flex-none">
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
            <select
              value={sort}
              onChange={e => onChangeSort(e.target.value)}
              aria-label="Sắp xếp ảnh"
              className="min-w-0 cursor-pointer bg-transparent text-inherit"
            >
              <option value="name-asc">Tên A → Z</option>
              <option value="name-desc">Tên Z → A</option>
              <option value="date-desc">Mới chụp nhất</option>
              <option value="date-asc">Cũ nhất</option>
              <option value="size-desc">Dung lượng lớn nhất</option>
            </select>
          </label>

          <div role="group" aria-label="Kiểu hiển thị" className="gallery-segment">
            {VIEW_MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleSetViewMode(id)}
                aria-pressed={viewMode === id}
                aria-label={label}
                title={label}
                className="!px-2"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        {helpOpen && (
              <div ref={helpRef} role="dialog" aria-label="Phím tắt" className="absolute right-3 top-full z-30 mt-2 w-72 sm:right-6 lg:right-8 rounded-xl border border-studio-line bg-[var(--studio-panel)] p-3 shadow-xl">
                <p className="mb-2 text-xs text-stone-400">Bấm một ảnh hoặc dùng phím mũi tên để bắt đầu.</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  {SHORTCUTS.map(([keys, label]) => (
                    <React.Fragment key={keys}>
                      <dt><kbd className="rounded border border-studio-line bg-studio-raised px-1.5 py-0.5 font-mono text-[11px] text-stone-200">{keys}</kbd></dt>
                      <dd className="text-stone-300">{label}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            )}
      </div>

      <div
        ref={setScrollContainer}
        onScroll={handleScroll}
        aria-busy={isLoading}
        className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4 lg:px-8 ${selectedFiles.length > 0 ? 'pb-36 sm:pb-28' : ''}`}
      >
        {displayedPhotos.length === 0 && isLoading ? (
          <p role="status" className="flex h-full items-center justify-center text-sm text-stone-400">Đang tải ảnh…</p>
        ) : displayedPhotos.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-4 py-6 text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-studio-line bg-white/5 text-rose-200">
              <ImageIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-stone-100">
              {hasSearch ? 'Không tìm thấy ảnh' : totalCount === 0 ? 'Thư mục chưa có ảnh' : 'Không có ảnh khớp bộ lọc'}
            </h2>
            <p className="mt-1 max-w-sm break-words text-xs leading-relaxed text-stone-400">
              {hasSearch
                ? `Hãy thử tên hoặc số hiệu khác thay cho “${searchQuery.trim()}”.`
                : totalCount === 0
                  ? 'Thêm ảnh vào thư mục trên máy tính hoặc chọn một thư mục ảnh khác.'
                  : 'Xóa bộ lọc để xem tất cả ảnh trong thư mục này.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {hasSearch ? (
                <button type="button" onClick={() => onChangeSearch('')} className="gallery-control">Xóa tìm kiếm</button>
              ) : totalCount === 0 ? (
                <>
                  <button type="button" onClick={onOpenSettings} className="gallery-control">Đổi thư mục ảnh</button>
                  {!currentFolder && (
                    <button type="button" onClick={onGenerateSamples} className="studio-primary">
                      <Sparkles className="h-4 w-4" /> Tạo ảnh mẫu
                    </button>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => onChangeFilter('all')} className="gallery-control">Xóa bộ lọc</button>
              )}
            </div>
          </div>
        ) : viewMode === 'list' ? (
          /* Table / List View */
          <div className="overflow-x-auto rounded-xl border border-studio-line bg-white/[0.025]">
            <table className="w-full min-w-[48rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      aria-label={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                      aria-pressed={isAllSelected}
                      className="p-1 hover:text-white"
                    >
                      {isAllSelected ? <CheckSquare className="w-4 h-4 text-rose-500" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="p-3 w-16">Xem trước</th>
                  <th className="p-3">Tên file ảnh</th>
                  <th className="p-3">Thư mục</th>
                  <th className="p-3 w-28">Đánh giá</th>
                  <th className="p-3 w-32">Album ảo</th>
                  <th className="p-3 w-24">Trạng thái</th>
                  <th className="p-3 w-20">Yêu thích</th>
                  <th className="p-3">Ghi chú & Retouch</th>
                  <th className="p-3 w-24 text-right">Dung lượng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {displayedPhotos.map((photo, index) => {
                  const isSelected = selectedPaths.has(photo.relPath);
                  const thumbUrl = photoImageUrl('thumbnail', photo);
                  return (
                    <tr
                      key={photo.relPath}
                      data-photo-path={photo.relPath}
                      onClick={event => handlePhotoClick(event, photo.relPath)}
                      data-cursor={index === cursorIndex}
                      className={`hover:bg-slate-800/50 cursor-pointer transition ${
                        isSelected ? 'bg-rose-950/20' : ''
                      } ${index === cursorIndex ? 'outline outline-2 -outline-offset-2 outline-[var(--studio-accent)]' : ''}`}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={event => onToggleSelect(photo.relPath, event.shiftKey)}
                          title="Shift + click để chọn một dải ảnh"
                          aria-label={`Chọn ảnh ${photo.name}`}
                          aria-pressed={isSelected}
                          className="p-1 hover:scale-110 transition"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-rose-500" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 hover:text-white" />
                          )}
                        </button>
                      </td>
                      <td className="p-2">
                        <img
                          src={thumbUrl}
                          alt={photo.name}
                          loading="lazy"
                          className="w-12 h-9 object-cover rounded-lg border border-slate-700 bg-slate-950"
                        />
                      </td>
                      <td className="p-3 font-medium text-slate-200">
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            handlePhotoClick(event, photo.relPath);
                          }}
                          className="rounded text-left hover:text-rose-200"
                        >
                          <span className="mr-1.5 font-mono text-[10px] text-rose-300" title="Số thứ tự (STT)">#{index + 1}</span>
                          {photo.name}
                        </button>
                      </td>
                      <td className="p-3 text-slate-400">
                        <span className="flex items-center gap-1 truncate max-w-[180px]" title={photo.folder || 'Thư mục gốc'}>
                          <Folder className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span>{photo.folder || 'Thư mục gốc'}</span>
                        </span>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        {photo.triage && ['pick', 'maybe', 'reject'].includes(photo.triage) ? (
                          <button
                            type="button"
                            disabled={!onSetTriage}
                            onClick={() => onSetTriage?.([photo.relPath], null)}
                            title="Bấm để bỏ đánh giá"
                            className={`group/triage px-2 py-0.5 rounded-full text-[10px] font-bold border transition hover:opacity-80 ${
                              photo.triage === 'pick' ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                : photo.triage === 'maybe' ? 'bg-amber-950 text-amber-400 border-amber-800'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {photo.triage === 'pick' ? '✓ Giữ lại' : photo.triage === 'maybe' ? '? Cân nhắc' : '✕ Bỏ qua'}
                            {onSetTriage && <span className="ml-1 hidden group-hover/triage:inline">×</span>}
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {photo.albums?.map(aId => {
                            const alb = virtualAlbums[aId];
                            const icon = ALBUM_ICONS[aId] || '🏷️';
                            return (
                              <span key={aId} className="px-1.5 py-0.2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[9px] font-medium">
                                {icon} {alb?.name || aId}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onToggleViewed(photo.relPath, !photo.isViewed)}
                          aria-label={`Đánh dấu ${photo.isViewed ? 'chưa xem' : 'đã xem'} ${photo.name}`}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition ${
                            photo.isViewed ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{photo.isViewed ? 'Đã xem' : 'Chưa xem'}</span>
                        </button>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(photo.relPath, !photo.isFavorite)}
                          aria-label={`Yêu thích ${photo.name}`}
                          aria-pressed={photo.isFavorite}
                          className="p-1 hover:scale-110 transition"
                        >
                          <Heart className={`w-4 h-4 ${photo.isFavorite ? 'text-rose-500 fill-rose-500' : 'text-slate-500 hover:text-rose-400'}`} />
                        </button>
                      </td>
                      <td className="p-3 text-slate-400 truncate max-w-[220px]">
                        <div className="flex items-center gap-2">
                          {photo.note && (
                            <span className="flex items-center gap-1 text-amber-300 text-[11px] truncate">
                              <MessageSquare className="w-3 h-3 shrink-0" />
                              <span className="truncate">{photo.note}</span>
                            </span>
                          )}
                          {photo.annotations?.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold shrink-0">
                              🎯 {photo.annotations.length}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-500">
                        {formatFileSize(photo.size)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Grid Views (Large, Medium, Small) */
          <div className="gallery-grid" data-density={viewMode}>
            {displayedPhotos.map((photo, index) => (
              <PhotoCard
                key={photo.relPath}
                photo={photo}
                position={index + 1}
                showFolder={!currentFolder}
                isSelected={selectedPaths.has(photo.relPath)}
                observePhoto={typeof IntersectionObserver === 'function' ? observePhoto : undefined}
                isCursor={index === cursorIndex}
                actions={cardActions}
                canTriage={Boolean(onSetTriage)}
                virtualAlbums={virtualAlbums}
              />
            ))}
          </div>
        )}
      </div>
      {selectedFiles.length > 0 && (
        <SelectionBar
          count={selectedFiles.length}
          albums={albums}
          filter={filter}
          virtualAlbums={virtualAlbums}
          isBatchAlbumPending={isBatchAlbumPending}
          canCompare={Boolean(onOpenCompare) && (displayedPhotos.length >= 2 || photos.length >= 2 || selectedFiles.length >= 2)}
          selectedTriage={selectedTriage}
          hasTriage={selectedHasTriage}
          onSetTriage={onSetTriage ? status => onSetTriage(selectedFiles, status) : undefined}
          onAddToAlbum={onAddSelectedToAlbum ? albumId => onAddSelectedToAlbum(albumId, selectedFiles) : undefined}
          onRemoveFromAlbum={onRemoveSelectedFromAlbum ? () => onRemoveSelectedFromAlbum(filter.slice(6), selectedFiles) : undefined}
          onMove={() => onOpenMoveModal(selectedFiles)}
          onCompare={handleCompareSelected}
          onMarkViewed={() => onBatchViewed(selectedFiles, true)}
          onMarkUnviewed={() => onBatchViewed(selectedFiles, false)}
          onExport={onOpenExportModal}
          onClear={onDeselectAll}
        />
      )}
    </main>
  );
}
