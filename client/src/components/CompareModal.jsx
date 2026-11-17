import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  X, Heart, CheckCircle2, ZoomIn, ZoomOut, RotateCw, 
  ArrowLeftRight, Check, ChevronLeft, ChevronRight,
  HelpCircle, Link2, Unlink, RotateCcw, Search, LayoutGrid, CheckSquare, Square
} from 'lucide-react';
import { photoImageUrl } from '../api.js';
import { getBurstComparisonStep } from './compareBurst.js';
import {
  assignComparisonSlot,
  buildComparisonCandidatePool,
  filterComparisonCandidates,
  resolveComparisonFolder,
  resolveComparisonPair,
} from './comparePhotoPicker.js';

const ALBUM_ICONS = {
  gate: '🚪',
  album: '📖',
  table: '🖼️',
  slide: '📽️',
};

const DEFAULT_ALBUM_CHIPS = [
  { id: 'gate', icon: '🚪', label: 'Ảnh cổng' },
  { id: 'album', icon: '📖', label: 'Album cưới' },
  { id: 'table', icon: '🖼️', label: 'Ảnh để bàn' },
  { id: 'slide', icon: '📽️', label: 'Slide tiệc' },
];

export function CompareModal({
  isOpen,
  onClose,
  photoA,
  photoB,
  currentFolder = '',
  allPhotos = [],
  burstPhotos = allPhotos,
  selectedFiles = [],
  onToggleSelect,
  onToggleFavorite,
  onToggleViewed,
  onSaveNote,
  onMovePhoto,
  onSetTriage,
  onKeepDuplicate,
  virtualAlbums = {},
  onToggleAlbum,
}) {
  const [zoom, setZoom] = useState(1);
  const [rotA, setRotA] = useState(0);
  const [rotB, setRotB] = useState(0);

  // Synchronized Pan State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panB, setPanB] = useState({ x: 0, y: 0 });
  const [isSyncPan, setIsSyncPan] = useState(true);

  // Photo Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState('B'); // 'A' | 'B'
  const [pickerScope, setPickerScope] = useState('all'); // 'all' | 'selected' | 'burst' | 'pick'
  const [pickerQuery, setPickerQuery] = useState('');

  // Dragging interaction state
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef(null); // 'A' or 'B'
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const targetFolder = useMemo(
    () => resolveComparisonFolder({
      currentFolder,
      photoA,
      photoB,
      selectedFiles,
    }),
    [currentFolder, photoA, photoB, selectedFiles],
  );

  // Merge available photos without duplicates; when comparing inside a single folder,
  // restrict choices strictly to photos inside that folder.
  const candidatePool = useMemo(
    () => buildComparisonCandidatePool({
      allPhotos,
      burstPhotos,
      photoA,
      photoB,
      selectedFiles,
      currentFolder,
    }),
    [allPhotos, burstPhotos, photoA, photoB, selectedFiles, currentFolder],
  );

  const [currentPhotoA, setCurrentPhotoA] = useState(photoA);
  const [currentPhotoB, setCurrentPhotoB] = useState(photoB);

  useEffect(() => {
    if (!isOpen) return;
    const resolved = resolveComparisonPair(candidatePool, photoA, photoB, {
      folder: targetFolder,
      currentFolder,
      selectedFiles,
    });
    setCurrentPhotoA(resolved.photoA);
    setCurrentPhotoB(resolved.photoB);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanB({ x: 0, y: 0 });
    setRotA(0);
    setRotB(0);
    setPickerQuery('');
    const hasMultipleSelected = Array.isArray(selectedFiles) && selectedFiles.length >= 3;
    setPickerScope(hasMultipleSelected ? 'selected' : 'all');
    setPickerOpen(hasMultipleSelected || !photoB);
    setActiveSlot('B');
  }, [photoA, photoB, isOpen]);

  // Keep the comparison current even when a frame is hidden by the gallery filter.
  useEffect(() => {
    const refreshPhoto = (photo) => {
      if (!photo) return photo;
      const matches = candidate => candidate.relPath === photo.relPath;
      return allPhotos.find(matches) ?? burstPhotos.find(matches) ?? photo;
    };
    setCurrentPhotoA(refreshPhoto);
    setCurrentPhotoB(refreshPhoto);
  }, [allPhotos, burstPhotos]);

  const burstPaths = useMemo(() => {
    const paths = currentPhotoA?.burstPhotos || currentPhotoB?.burstPhotos || [];
    return Array.isArray(paths) ? paths : [];
  }, [currentPhotoA, currentPhotoB]);

  const pickerPhotos = useMemo(
    () => filterComparisonCandidates(candidatePool, {
      scope: pickerScope,
      selectedFiles,
      burstPaths,
      query: pickerQuery,
    }),
    [candidatePool, pickerScope, selectedFiles, burstPaths, pickerQuery],
  );

  const selectedSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const selectedInPoolCount = useMemo(
    () => candidatePool.filter(item => selectedSet.has(item.relPath)).length,
    [candidatePool, selectedSet],
  );

  const burstStep = useMemo(
    () => getBurstComparisonStep(currentPhotoA, currentPhotoB, allPhotos, burstPhotos),
    [currentPhotoA, currentPhotoB, allPhotos, burstPhotos],
  );

  const assignPhotoToSlot = useCallback((slot, chosenPhoto) => {
    if (!chosenPhoto) return;
    const next = assignComparisonSlot(currentPhotoA, currentPhotoB, slot, chosenPhoto);
    if (next.photoA?.relPath !== currentPhotoA?.relPath) {
      setCurrentPhotoA(next.photoA);
      setRotA(0);
      if (!isSyncPan) setPan({ x: 0, y: 0 });
    }
    if (next.photoB?.relPath !== currentPhotoB?.relPath) {
      setCurrentPhotoB(next.photoB);
      setRotB(0);
      setPanB({ x: 0, y: 0 });
    }
  }, [currentPhotoA, currentPhotoB, isSyncPan]);

  const handleSwapPanels = () => {
    if (!currentPhotoA || !currentPhotoB) return;
    setCurrentPhotoA(currentPhotoB);
    setCurrentPhotoB(currentPhotoA);
    setRotA(rotB);
    setRotB(rotA);
  };

  const handleContinueBurst = (keepPanel) => {
    if (!burstStep?.nextPhoto) return;

    if (keepPanel === 'A') {
      setCurrentPhotoB(burstStep.nextPhoto);
      setRotB(0);
      setPanB({ x: 0, y: 0 });
    } else {
      setCurrentPhotoA(burstStep.nextPhoto);
      setRotA(0);
      if (!isSyncPan) setPan({ x: 0, y: 0 });
    }
  };

  // Mouse drag handlers for synchronized / independent pan
  const handleMouseDown = (panel, e) => {
    if (zoom <= 1) return;
    e.preventDefault();
    isDraggingRef.current = true;
    dragTargetRef.current = panel;
    const currentActivePan = (panel === 'B' && !isSyncPan) ? panB : pan;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: currentActivePan.x,
      panY: currentActivePan.y,
    };
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const newX = dragStartRef.current.panX + dx;
    const newY = dragStartRef.current.panY + dy;

    if (isSyncPan) {
      setPan({ x: newX, y: newY });
      setPanB({ x: newX, y: newY });
    } else {
      if (dragTargetRef.current === 'A') {
        setPan({ x: newX, y: newY });
      } else {
        setPanB({ x: newX, y: newY });
      }
    }
  }, [isSyncPan]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Wheel zoom handler
  const handleWheel = (e) => {
    if (e.deltaY < 0) {
      setZoom(z => Math.min(4, Math.round((z + 0.25) * 100) / 100));
    } else {
      setZoom(z => {
        const next = Math.max(0.5, Math.round((z - 0.25) * 100) / 100);
        if (next <= 1) {
          setPan({ x: 0, y: 0 });
          setPanB({ x: 0, y: 0 });
        }
        return next;
      });
    }
  };

  const handleResetZoomPan = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanB({ x: 0, y: 0 });
  };

  // Photo A handlers
  const handleToggleFavA = () => {
    if (!currentPhotoA) return;
    const nextVal = !currentPhotoA.isFavorite;
    setCurrentPhotoA(prev => ({ ...prev, isFavorite: nextVal }));
    onToggleFavorite(currentPhotoA.relPath, nextVal);
  };

  const handleTriageA = (status) => {
    if (!currentPhotoA || !onSetTriage) return;
    const nextStatus = currentPhotoA.triage === status ? null : status;
    setCurrentPhotoA(prev => ({ ...prev, triage: nextStatus, isViewed: nextStatus ? true : prev.isViewed }));
    onSetTriage([currentPhotoA.relPath], nextStatus);
  };

  const handleKeepOnlyA = () => {
    if (!currentPhotoA) return;
    setCurrentPhotoA(prev => prev ? { ...prev, triage: 'pick', isViewed: true } : prev);
    if (currentPhotoB) {
      setCurrentPhotoB(prev => prev ? { ...prev, triage: 'reject', isViewed: true } : prev);
    }
    if (onKeepDuplicate && currentPhotoB) {
      onKeepDuplicate(currentPhotoA.relPath, [currentPhotoB.relPath]);
    } else if (onSetTriage) {
      onSetTriage([currentPhotoA.relPath], 'pick');
      if (currentPhotoB) onSetTriage([currentPhotoB.relPath], 'reject');
    }
  };

  const handleToggleAlbumA = (albumId) => {
    if (!currentPhotoA || !onToggleAlbum) return;
    const albums = Array.isArray(currentPhotoA.albums) ? currentPhotoA.albums : [];
    const inAlbum = albums.includes(albumId);
    const nextAlbums = inAlbum ? albums.filter(a => a !== albumId) : [...albums, albumId];
    setCurrentPhotoA(prev => ({ ...prev, albums: nextAlbums }));
    onToggleAlbum(albumId, currentPhotoA.relPath, !inAlbum);
  };

  // Photo B handlers
  const handleToggleFavB = () => {
    if (!currentPhotoB) return;
    const nextVal = !currentPhotoB.isFavorite;
    setCurrentPhotoB(prev => ({ ...prev, isFavorite: nextVal }));
    onToggleFavorite(currentPhotoB.relPath, nextVal);
  };

  const handleTriageB = (status) => {
    if (!currentPhotoB || !onSetTriage) return;
    const nextStatus = currentPhotoB.triage === status ? null : status;
    setCurrentPhotoB(prev => ({ ...prev, triage: nextStatus, isViewed: nextStatus ? true : prev.isViewed }));
    onSetTriage([currentPhotoB.relPath], nextStatus);
  };

  const handleKeepOnlyB = () => {
    if (!currentPhotoB) return;
    setCurrentPhotoB(prev => prev ? { ...prev, triage: 'pick', isViewed: true } : prev);
    if (currentPhotoA) {
      setCurrentPhotoA(prev => prev ? { ...prev, triage: 'reject', isViewed: true } : prev);
    }
    if (onKeepDuplicate && currentPhotoA) {
      onKeepDuplicate(currentPhotoB.relPath, [currentPhotoA.relPath]);
    } else if (onSetTriage) {
      onSetTriage([currentPhotoB.relPath], 'pick');
      if (currentPhotoA) onSetTriage([currentPhotoA.relPath], 'reject');
    }
  };

  const handleToggleAlbumB = (albumId) => {
    if (!currentPhotoB || !onToggleAlbum) return;
    const albums = Array.isArray(currentPhotoB.albums) ? currentPhotoB.albums : [];
    const inAlbum = albums.includes(albumId);
    const nextAlbums = inAlbum ? albums.filter(a => a !== albumId) : [...albums, albumId];
    setCurrentPhotoB(prev => ({ ...prev, albums: nextAlbums }));
    onToggleAlbum(albumId, currentPhotoB.relPath, !inAlbum);
  };

  // Navigation list (uses active picker list if non-empty, otherwise candidatePool)
  const navList = pickerPhotos.length >= 2 ? pickerPhotos : candidatePool;
  const findIndex = (p) => navList.findIndex(item => item.relPath === p?.relPath);

  const handleNextA = () => {
    const idx = findIndex(currentPhotoA);
    if (idx >= 0 && idx < navList.length - 1) assignPhotoToSlot('A', navList[idx + 1]);
  };
  const handlePrevA = () => {
    const idx = findIndex(currentPhotoA);
    if (idx > 0) assignPhotoToSlot('A', navList[idx - 1]);
  };

  const handleNextB = () => {
    const idx = findIndex(currentPhotoB);
    if (idx >= 0 && idx < navList.length - 1) assignPhotoToSlot('B', navList[idx + 1]);
  };
  const handlePrevB = () => {
    const idx = findIndex(currentPhotoB);
    if (idx > 0) assignPhotoToSlot('B', navList[idx - 1]);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case '1':
          handleTriageA('pick');
          break;
        case '2':
          handleTriageA('maybe');
          break;
        case '3':
          handleTriageA('reject');
          break;
        case '7':
        case '!':
          handleTriageB('pick');
          break;
        case '8':
        case '@':
          handleTriageB('maybe');
          break;
        case '9':
        case '#':
          handleTriageB('reject');
          break;
        case '+':
        case '=':
          setZoom(z => Math.min(4, Math.round((z + 0.25) * 100) / 100));
          break;
        case '-':
        case '_':
          setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
          break;
        case '0':
          handleResetZoomPan();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentPhotoA, currentPhotoB, onClose]);

  if (!isOpen || !currentPhotoA || !currentPhotoB) return null;

  // Screen-sized previews at fit size; full originals only once zoomed in.
  const imageEndpoint = zoom > 1 ? 'original' : 'preview';
  const urlA = photoImageUrl(imageEndpoint, currentPhotoA);
  const urlB = photoImageUrl(imageEndpoint, currentPhotoB);

  const activePanA = pan;
  const activePanB = isSyncPan ? pan : panB;
  const isSelectedA = selectedSet.has(currentPhotoA.relPath);
  const isSelectedB = selectedSet.has(currentPhotoB.relPath);

  const albumChips = Object.keys(virtualAlbums).length > 0
    ? Object.values(virtualAlbums).map(alb => ({
        id: alb.id,
        icon: ALBUM_ICONS[alb.id] || '🏷️',
        label: alb.name || alb.id,
      }))
    : DEFAULT_ALBUM_CHIPS;

  return (
    <div className="theme-dark fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md select-none">
      {/* Top Bar */}
      <div className="h-14 px-3 sm:px-6 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm shrink-0">
            <ArrowLeftRight className="w-5 h-5 shrink-0" />
            <span>So sánh 2 ảnh</span>
          </div>

          {targetFolder !== null && (
            <span
              className="hidden md:inline-flex items-center px-2 py-1 rounded-lg bg-slate-900 border border-slate-700/80 text-[11px] font-medium text-slate-300 truncate max-w-48"
              title={`Chỉ chọn các ảnh trong thư mục: ${targetFolder || 'Thư mục gốc'}`}
            >
              📁 {targetFolder || 'Thư mục gốc'}
            </span>
          )}

          <button
            type="button"
            onClick={() => setPickerOpen(open => !open)}
            aria-expanded={pickerOpen}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border ${
              pickerOpen
                ? 'bg-rose-500/20 text-rose-200 border-rose-400/50 shadow-sm'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
            title="Mở khay chọn ảnh bất kỳ để đưa vào khung A hoặc khung B"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-rose-300" />
            <span>Chọn ảnh ({candidatePool.length})</span>
          </button>

          <button
            type="button"
            onClick={handleSwapPanels}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:text-white hover:bg-slate-700 transition hidden sm:flex items-center gap-1"
            title="Đổi vị trí Ảnh A và Ảnh B"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Đổi A ⇄ B</span>
          </button>
        </div>

        {/* Center / Right: Synchronized Zoom & Pan Controls */}
        <div className="flex items-center gap-2">
          {/* Sync Pan Toggle Button */}
          <button
            type="button"
            onClick={() => setIsSyncPan(prev => !prev)}
            aria-label="Đồng bộ góc nhìn"
            aria-pressed={isSyncPan}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border ${
              isSyncPan
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Bật/Tắt đồng bộ góc nhìn: Khi bật, kéo rê một ảnh thì ảnh kia di chuyển theo cùng tọa độ"
          >
            {isSyncPan ? <Link2 className="w-3.5 h-3.5 text-blue-400" /> : <Unlink className="w-3.5 h-3.5 text-slate-400" />}
            <span className="hidden sm:inline">{isSyncPan ? 'Đồng bộ Pan: Bật' : 'Đồng bộ Pan: Tắt'}</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-slate-800/80 border border-slate-700/60 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-700"
              title="Thu nhỏ cả 2 ảnh (-)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono px-2 text-slate-300 min-w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-700"
              title="Phóng to đồng bộ cả 2 ảnh (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoomPan}
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-700"
              title="Khôi phục kích thước & vị trí gốc (Phím 0)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-rose-600/80 rounded-xl transition ml-1"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Collapsible Photo Picker Drawer */}
      {pickerOpen && (
        <section
          aria-label="Chọn ảnh để so sánh"
          className="shrink-0 border-b border-slate-800 bg-slate-900/95 px-3 py-2.5 sm:px-6 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-300 mr-1">Click ảnh để gán vào:</span>
              <button
                type="button"
                aria-pressed={activeSlot === 'A'}
                onClick={() => setActiveSlot('A')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                  activeSlot === 'A'
                    ? 'bg-blue-600 text-paper border-blue-400'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
              >
                Khung ẢNH A ({currentPhotoA.name})
              </button>
              <button
                type="button"
                aria-pressed={activeSlot === 'B'}
                onClick={() => setActiveSlot('B')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                  activeSlot === 'B'
                    ? 'bg-rose-600 text-paper border-rose-400'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
              >
                Khung ẢNH B ({currentPhotoB.name})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={pickerScope === 'all'}
                onClick={() => setPickerScope('all')}
                className={`px-2 py-1 rounded-lg text-xs font-medium border transition ${
                  pickerScope === 'all'
                    ? 'bg-white/15 text-white border-slate-500'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {targetFolder !== null ? `Trong thư mục (${candidatePool.length})` : `Tất cả (${candidatePool.length})`}
              </button>
              {selectedInPoolCount > 0 && (
                <button
                  type="button"
                  aria-pressed={pickerScope === 'selected'}
                  onClick={() => setPickerScope('selected')}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition ${
                    pickerScope === 'selected'
                      ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  Đang chọn ({selectedInPoolCount})
                </button>
              )}
              {burstPaths.length > 1 && (
                <button
                  type="button"
                  aria-pressed={pickerScope === 'burst'}
                  onClick={() => setPickerScope('burst')}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition ${
                    pickerScope === 'burst'
                      ? 'bg-blue-500/20 text-blue-200 border-blue-400/50'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  Cùng loạt chụp ({burstPaths.length})
                </button>
              )}
              <button
                type="button"
                aria-pressed={pickerScope === 'pick'}
                onClick={() => setPickerScope('pick')}
                className={`px-2 py-1 rounded-lg text-xs font-medium border transition ${
                  pickerScope === 'pick'
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                Giữ lại
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={pickerQuery}
                  onChange={e => setPickerQuery(e.target.value)}
                  placeholder="Tìm tên ảnh…"
                  aria-label="Tìm ảnh để so sánh"
                  className="pl-7 pr-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-400 w-36 sm:w-44"
                />
              </div>
            </div>
          </div>

          {/* Horizontal Filmstrip of Thumbnails */}
          {pickerPhotos.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">Không có ảnh khớp bộ lọc hiện tại.</p>
          ) : (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
              {pickerPhotos.slice(0, 60).map(item => {
                const isA = item.relPath === currentPhotoA.relPath;
                const isB = item.relPath === currentPhotoB.relPath;
                return (
                  <div
                    key={item.relPath}
                    className={`group relative shrink-0 w-28 rounded-lg border overflow-hidden bg-slate-950 transition ${
                      isA
                        ? 'border-blue-400 ring-1 ring-blue-400'
                        : isB
                          ? 'border-rose-400 ring-1 ring-rose-400'
                          : 'border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => assignPhotoToSlot(activeSlot, item)}
                      className="block w-full text-left"
                      title={`Đưa ${item.name} vào Khung ${activeSlot}`}
                    >
                      <img
                        src={photoImageUrl('thumbnail', item)}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-16 object-cover bg-black"
                      />
                      <div className="px-1.5 py-1 flex items-center justify-between gap-1">
                        <span className="truncate text-[10px] font-medium text-slate-200">{item.name}</span>
                        {item.triage === 'pick' && <span className="text-[10px] text-emerald-400 font-bold" title="Giữ lại">✓</span>}
                        {item.triage === 'reject' && <span className="text-[10px] text-slate-500 font-bold" title="Bỏ qua">✕</span>}
                      </div>
                    </button>

                    {/* Direct A / B slot buttons on thumbnail */}
                    <div className="absolute top-1 left-1 right-1 flex items-center justify-between pointer-events-none">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          assignPhotoToSlot('A', item);
                        }}
                        aria-label={`Đặt ${item.name} làm Ảnh A`}
                        title="Đặt làm Ảnh A"
                        className={`pointer-events-auto px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                          isA
                            ? 'bg-blue-500 text-paper shadow'
                            : 'bg-black/75 text-blue-200 opacity-80 hover:opacity-100 hover:bg-blue-600 hover:text-white'
                        }`}
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          assignPhotoToSlot('B', item);
                        }}
                        aria-label={`Đặt ${item.name} làm Ảnh B`}
                        title="Đặt làm Ảnh B"
                        className={`pointer-events-auto px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                          isB
                            ? 'bg-rose-500 text-paper shadow'
                            : 'bg-black/75 text-rose-200 opacity-80 hover:opacity-100 hover:bg-rose-600 hover:text-white'
                        }`}
                      >
                        B
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {burstStep && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-slate-800 bg-slate-900 px-3 py-1.5 sm:px-6">
          <p role="status" className="text-xs text-slate-300">
            {burstStep.nextPhoto
              ? `Ảnh tiếp theo trong loạt chụp · ${burstStep.nextPhoto.name}`
              : burstStep.isAtEnd ? 'Đã tới ảnh cuối của loạt chụp' : 'Ảnh tiếp theo trong loạt chụp chưa có sẵn'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {['A', 'B'].map(panel => (
              <button
                key={panel}
                type="button"
                onClick={() => handleContinueBurst(panel)}
                aria-disabled={!burstStep.nextPhoto}
                title={`Giữ ảnh ${panel} trong cửa sổ và thay ảnh còn lại bằng ảnh kế tiếp trong loạt chụp`}
                className="rounded-lg border border-blue-500/50 bg-blue-950 px-2.5 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-900 aria-disabled:cursor-default aria-disabled:border-slate-700 aria-disabled:bg-slate-800 aria-disabled:text-slate-400"
              >
                So tiếp với ảnh {panel}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Split Panels */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-hidden">
        {/* Panel A */}
        <div className="flex flex-col h-full bg-slate-950/40 min-h-0">
          {/* Header A */}
          <div className="p-2.5 sm:p-3 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  setActiveSlot('A');
                  setPickerOpen(true);
                }}
                className="px-2 py-0.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded text-xs font-bold font-mono shrink-0"
                title="Bấm để chọn ảnh khác cho Khung A"
              >
                ẢNH A
              </button>

              <select
                aria-label="Chọn ảnh A"
                value={currentPhotoA.relPath}
                onChange={(e) => {
                  const found = candidatePool.find(item => item.relPath === e.target.value);
                  if (found) assignPhotoToSlot('A', found);
                }}
                className="min-w-0 max-w-[160px] sm:max-w-[220px] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-slate-200 truncate cursor-pointer [color-scheme:dark]"
                title={currentPhotoA.relPath}
              >
                {candidatePool.map(item => (
                  <option key={item.relPath} value={item.relPath}>
                    {item.name}{item.folder && item.folder !== 'Thư mục gốc' ? ` (${item.folder})` : ''}
                  </option>
                ))}
              </select>

              {currentPhotoA.triage === 'pick' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 border border-emerald-600 text-emerald-300 flex items-center gap-1 shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="hidden sm:inline">Giữ lại</span>
                </span>
              )}
              {currentPhotoA.triage === 'maybe' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 border border-amber-600 text-amber-300 flex items-center gap-1 shrink-0">
                  <HelpCircle className="w-3 h-3 text-amber-400" />
                  <span className="hidden sm:inline">Cân nhắc</span>
                </span>
              )}
              {currentPhotoA.triage === 'reject' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950 border border-rose-600 text-rose-300 flex items-center gap-1 shrink-0">
                  <X className="w-3 h-3 text-rose-400" />
                  <span className="hidden sm:inline">Bỏ qua</span>
                </span>
              )}
              {currentPhotoA.exif?.camera && (
                <span className="hidden xl:inline text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800 truncate" title="Thông số EXIF">
                  📷 {currentPhotoA.exif.camera} {currentPhotoA.exif.aperture ? `• ${currentPhotoA.exif.aperture}` : ''} {currentPhotoA.exif.iso ? `• ISO ${currentPhotoA.exif.iso}` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onToggleSelect && (
                <button
                  type="button"
                  onClick={() => onToggleSelect(currentPhotoA.relPath, false)}
                  aria-pressed={isSelectedA}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition ${
                    isSelectedA
                      ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                  title="Tích chọn ảnh A vào danh sách đang chọn ngoài thư viện"
                >
                  {isSelectedA ? <CheckSquare className="w-3.5 h-3.5 text-rose-400" /> : <Square className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{isSelectedA ? 'Đã chọn' : 'Chọn'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePrevA}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                title="Đổi sang ảnh trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextA}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                title="Đổi sang ảnh sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRotA(r => (r + 90) % 360)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                title="Xoay ảnh A 90°"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Viewport A */}
          <div 
            onWheel={handleWheel}
            onMouseDown={(e) => handleMouseDown('A', e)}
            className="flex-1 relative flex items-center justify-center overflow-hidden p-3 cursor-grab active:cursor-grabbing"
            title={zoom > 1 ? "Nhấp và kéo để di chuyển vùng nhìn (Pan)" : "Lăn chuột để phóng to"}
          >
            <img
              src={urlA}
              alt={currentPhotoA.name}
              draggable={false}
              style={{
                transform: `translate(${activePanA.x}px, ${activePanA.y}px) rotate(${rotA}deg) scale(${zoom})`,
                transition: isDraggingRef.current ? 'none' : 'transform 0.1s ease-out',
                userSelect: 'none',
              }}
              className="max-h-full max-w-full object-contain drop-shadow-xl rounded"
            />
          </div>

          {/* Controls Footer A */}
          <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Triage A */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleKeepOnlyA}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-200 border border-emerald-700/80 transition"
                title="Đánh dấu Giữ lại cho Ảnh A và Bỏ qua cho Ảnh B"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Chỉ giữ A</span>
              </button>

              <button
                type="button"
                onClick={() => handleTriageA('pick')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  currentPhotoA.triage === 'pick'
                    ? 'bg-emerald-600 text-paper ring-1 ring-emerald-300'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Giữ lại ảnh A (Phím 1)"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Giữ lại</span>
              </button>

              <button
                type="button"
                onClick={() => handleTriageA('maybe')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  currentPhotoA.triage === 'maybe'
                    ? 'bg-amber-700 text-paper ring-1 ring-amber-300'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Cân nhắc ảnh A (Phím 2)"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Cân nhắc</span>
              </button>

              <button
                type="button"
                onClick={() => handleTriageA('reject')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  currentPhotoA.triage === 'reject'
                    ? 'bg-rose-700 text-paper ring-1 ring-rose-300'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Bỏ qua ảnh A (Phím 3)"
              >
                <X className="w-3.5 h-3.5" />
                <span>Bỏ qua</span>
              </button>
            </div>

            {/* Favorite and album, one row */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleFavA}
                aria-pressed={Boolean(currentPhotoA.isFavorite)}
                className={`p-1.5 rounded-lg text-xs font-semibold transition ${
                  currentPhotoA.isFavorite ? 'bg-rose-600 text-paper' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
                title="Yêu thích ảnh A"
                aria-label="Yêu thích ảnh A"
              >
                <Heart className={`w-3.5 h-3.5 ${currentPhotoA.isFavorite ? 'fill-current' : ''}`} />
              </button>
              {albumChips.length > 0 && (
                <label className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                  <span className="sr-only">Album của ảnh A</span>
                  <select
                    value=""
                    onChange={event => event.target.value && handleToggleAlbumA(event.target.value)}
                    className="max-w-[9rem] cursor-pointer bg-transparent text-inherit"
                    title="Gắn hoặc gỡ ảnh A khỏi album"
                  >
                    <option value="">
                      {(() => {
                        const count = albumChips.filter(alb => currentPhotoA.albums?.includes(alb.id)).length;
                        return count ? `Album (${count})` : 'Album';
                      })()}
                    </option>
                    {albumChips.map(alb => (
                      <option key={alb.id} value={alb.id}>
                        {currentPhotoA.albums?.includes(alb.id) ? '✓ ' : '\u2003'}{alb.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Panel B */}
        <div className="flex flex-col h-full bg-slate-950/40 min-h-0">
          {/* Header B */}
          <div className="p-2.5 sm:p-3 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  setActiveSlot('B');
                  setPickerOpen(true);
                }}
                className="px-2 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded text-xs font-bold font-mono shrink-0"
                title="Bấm để chọn ảnh khác cho Khung B"
              >
                ẢNH B
              </button>

              <select
                aria-label="Chọn ảnh B"
                value={currentPhotoB.relPath}
                onChange={(e) => {
                  const found = candidatePool.find(item => item.relPath === e.target.value);
                  if (found) assignPhotoToSlot('B', found);
                }}
                className="min-w-0 max-w-[160px] sm:max-w-[220px] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-slate-200 truncate cursor-pointer [color-scheme:dark]"
                title={currentPhotoB.relPath}
              >
                {candidatePool.map(item => (
                  <option key={item.relPath} value={item.relPath}>
                    {item.name}{item.folder && item.folder !== 'Thư mục gốc' ? ` (${item.folder})` : ''}
                  </option>
                ))}
              </select>

              {currentPhotoB.triage === 'pick' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 border border-emerald-600 text-emerald-300 flex items-center gap-1 shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="hidden sm:inline">Giữ lại</span>
                </span>
              )}
              {currentPhotoB.triage === 'maybe' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 border border-amber-600 text-amber-300 flex items-center gap-1 shrink-0">
                  <HelpCircle className="w-3 h-3 text-amber-400" />
                  <span className="hidden sm:inline">Cân nhắc</span>
                </span>
              )}
              {currentPhotoB.triage === 'reject' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950 border border-rose-600 text-rose-300 flex items-center gap-1 shrink-0">
                  <X className="w-3 h-3 text-rose-400" />
                  <span className="hidden sm:inline">Bỏ qua</span>
                </span>
              )}
              {currentPhotoB.exif?.camera && (
                <span className="hidden xl:inline text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800 truncate" title="Thông số EXIF">
                  📷 {currentPhotoB.exif.camera} {currentPhotoB.exif.aperture ? `• ${currentPhotoB.exif.aperture}` : ''} {currentPhotoB.exif.iso ? `• ISO ${currentPhotoB.exif.iso}` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onToggleSelect && (
                <button
                  type="button"
                  onClick={() => onToggleSelect(currentPhotoB.relPath, false)}
                  aria-pressed={isSelectedB}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition ${
                    isSelectedB
                      ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                  title="Tích chọn ảnh B vào danh sách đang chọn ngoài thư viện"
                >
                  {isSelectedB ? <CheckSquare className="w-3.5 h-3.5 text-rose-400" /> : <Square className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{isSelectedB ? 'Đã chọn' : 'Chọn'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePrevB}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                title="Đổi sang ảnh trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextB}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                title="Đổi sang ảnh sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRotB(r => (r + 90) % 360)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                title="Xoay ảnh B 90°"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Viewport B */}
          <div 
            onWheel={handleWheel}
            onMouseDown={(e) => handleMouseDown('B', e)}
            className="flex-1 relative flex items-center justify-center overflow-hidden p-3 cursor-grab active:cursor-grabbing"
            title={zoom > 1 ? "Nhấp và kéo để di chuyển vùng nhìn (Pan)" : "Lăn chuột để phóng to"}
          >
            <img
              src={urlB}
              alt={currentPhotoB.name}
              draggable={false}
              style={{
                transform: `translate(${activePanB.x}px, ${activePanB.y}px) rotate(${rotB}deg) scale(${zoom})`,
                transition: isDraggingRef.current ? 'none' : 'transform 0.1s ease-out',
                userSelect: 'none',
              }}
              className="max-h-full max-w-full object-contain drop-shadow-xl rounded"
            />
          </div>

          {/* Controls Footer B */}
          <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Triage B */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleKeepOnlyB}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-200 border border-emerald-700/80 transition"
                title="Đánh dấu Giữ lại cho Ảnh B và Bỏ qua cho Ảnh A"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Chỉ giữ B</span>
              </button>

              <button
                type="button"
                onClick={() => handleTriageB('pick')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  currentPhotoB.triage === 'pick'
                    ? 'bg-emerald-600 text-paper ring-1 ring-emerald-300'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Giữ lại ảnh B (Phím 7)"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Giữ lại</span>
              </button>

              <button
                type="button"
                onClick={() => handleTriageB('maybe')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  currentPhotoB.triage === 'maybe'
                    ? 'bg-amber-700 text-paper ring-1 ring-amber-300'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Cân nhắc ảnh B (Phím 8)"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Cân nhắc</span>
              </button>

              <button
                type="button"
                onClick={() => handleTriageB('reject')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  currentPhotoB.triage === 'reject'
                    ? 'bg-rose-700 text-paper ring-1 ring-rose-300'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Bỏ qua ảnh B (Phím 9)"
              >
                <X className="w-3.5 h-3.5" />
                <span>Bỏ qua</span>
              </button>
            </div>

            {/* Favorite and album, one row */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleFavB}
                aria-pressed={Boolean(currentPhotoB.isFavorite)}
                className={`p-1.5 rounded-lg text-xs font-semibold transition ${
                  currentPhotoB.isFavorite ? 'bg-rose-600 text-paper' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
                title="Yêu thích ảnh B"
                aria-label="Yêu thích ảnh B"
              >
                <Heart className={`w-3.5 h-3.5 ${currentPhotoB.isFavorite ? 'fill-current' : ''}`} />
              </button>
              {albumChips.length > 0 && (
                <label className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                  <span className="sr-only">Album của ảnh B</span>
                  <select
                    value=""
                    onChange={event => event.target.value && handleToggleAlbumB(event.target.value)}
                    className="max-w-[9rem] cursor-pointer bg-transparent text-inherit"
                    title="Gắn hoặc gỡ ảnh B khỏi album"
                  >
                    <option value="">
                      {(() => {
                        const count = albumChips.filter(alb => currentPhotoB.albums?.includes(alb.id)).length;
                        return count ? `Album (${count})` : 'Album';
                      })()}
                    </option>
                    {albumChips.map(alb => (
                      <option key={alb.id} value={alb.id}>
                        {currentPhotoB.albums?.includes(alb.id) ? '✓ ' : '\u2003'}{alb.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
