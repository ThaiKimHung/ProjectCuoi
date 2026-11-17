import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeftRight, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Ellipsis, Folder, FolderInput,
  EyeOff, Heart, HelpCircle, MessageSquare, RotateCcw, RotateCw, Undo2, X, Zap, ZoomIn, ZoomOut,
} from 'lucide-react';
import { RETOUCH_PRESETS } from '../constants/retouchPresets.js';
import { findBurstNeighbor } from '../photoBurst.js';

const TRIAGE_ACTIONS = [
  { status: 'pick', label: 'Giữ lại', shortcut: '1', icon: Check, tone: 'text-emerald-300' },
  { status: 'maybe', label: 'Cân nhắc', shortcut: '2', icon: HelpCircle, tone: 'text-amber-300' },
  { status: 'reject', label: 'Bỏ qua', shortcut: '3', icon: X, tone: 'text-stone-300' },
];

const ALBUM_SHORTCUTS = { c: 'gate', a: 'album', b: 'table', s: 'slide' };
const thumbnailUrl = relPath => `/api/thumbnail?path=${encodeURIComponent(relPath)}`;
const previewUrl = relPath => `/api/preview?path=${encodeURIComponent(relPath)}`;
// Swap layers only after the new image is decoded, so there is no blank frame
// between hiding the smaller image and painting the larger one.
const markDecoded = (event, setStatus, path) => {
  const image = event.currentTarget;
  const done = () => setStatus({ path, ready: true });
  if (typeof image.decode === 'function') image.decode().then(done, done);
  else done();
};

function PhotoTool({ icon: Icon, label, pressed, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="gallery-control !min-h-10 !shrink !whitespace-normal text-left disabled:opacity-40"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}

const FILMSTRIP_TRIAGE = { pick: 'bg-emerald-400', maybe: 'bg-amber-400', reject: 'bg-stone-400' };
const FILMSTRIP_WINDOW = 40;

// Folders the user moved photos into most recently, shown as one-click buttons.
const RECENT_MOVE_KEY = 'wedding_recent_move_folders';
const RECENT_MOVE_LIMIT = 4;
const readRecentMoveFolders = () => {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_MOVE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch { return []; }
};
const photoDirectory = relPath => {
  const slash = relPath.lastIndexOf('/');
  return slash < 0 ? '' : relPath.slice(0, slash);
};

function MoveBar({ photo, folders, onMovePhotos, onOpenMoveModal, isMoving, className = '' }) {
  const [recent, setRecent] = useState(readRecentMoveFolders);
  const currentDir = photoDirectory(photo.relPath);
  const byPath = new Map(folders.map(folder => [folder.relPath, folder]));
  const recentFolders = recent.map(relPath => byPath.get(relPath)).filter(Boolean);

  const moveTo = (relPath) => {
    if (isMoving || relPath === currentDir) return;
    const next = [relPath, ...recent.filter(item => item !== relPath)].slice(0, RECENT_MOVE_LIMIT);
    setRecent(next);
    try { localStorage.setItem(RECENT_MOVE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    onMovePhotos([photo.relPath], relPath);
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="flex shrink-0 items-center gap-1 text-xs text-stone-400" title="Chuyển ảnh vào thư mục">
        <FolderInput className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Chuyển vào:</span>
      </span>
      {recentFolders.map(folder => {
        const here = folder.relPath === currentDir;
        return (
          <button
            key={folder.relPath}
            type="button"
            onClick={() => moveTo(folder.relPath)}
            disabled={isMoving || here}
            title={here ? 'Ảnh đang ở thư mục này' : `Chuyển ảnh vào “${folder.relPath || 'Thư mục gốc'}”`}
            className="gallery-control max-w-[10rem] !px-2.5 disabled:opacity-40"
          >
            <Folder className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
            <span className="truncate">{folder.depth === 0 ? 'Thư mục gốc' : folder.name}</span>
          </button>
        );
      })}
      <select
        value=""
        disabled={isMoving}
        onChange={event => {
          const value = event.target.value;
          event.target.blur(); // give arrow keys back to photo navigation
          if (value.startsWith('dir:')) moveTo(value.slice(4));
          else if (value === 'dialog') onOpenMoveModal?.([photo.relPath]);
        }}
        aria-label="Chuyển ảnh vào thư mục"
        title="Chọn thư mục để chuyển ảnh này vào (phím M mở hộp thoại)"
        className="gallery-control max-w-[13rem] cursor-pointer !px-2.5"
      >
        <option value="">{isMoving ? 'Đang chuyển…' : recentFolders.length ? 'Thư mục khác…' : 'Chọn thư mục…'}</option>
        {folders.map(folder => (
          <option key={folder.relPath} value={`dir:${folder.relPath}`} disabled={folder.relPath === currentDir}>
            {'\u00A0\u00A0\u00A0'.repeat(folder.depth)}{folder.depth === 0 ? 'Thư mục gốc' : folder.name} ({folder.photoCount})
            {folder.relPath === currentDir ? ' — đang ở đây' : ''}
          </option>
        ))}
        {onOpenMoveModal && <option value="dialog">Mở hộp thoại chuyển ảnh…</option>}
      </select>
    </div>
  );
}

// Thumbnails around the current photo. Only a window around it is rendered, so long
// collections stay light; the strip re-centres on the active photo.
function Filmstrip({ photos, activePath, onSelect, className = '' }) {
  const activeIndex = photos.findIndex(photo => photo.relPath === activePath);
  const center = activeIndex < 0 ? 0 : activeIndex;
  const start = Math.max(0, center - FILMSTRIP_WINDOW);
  const visible = photos.slice(start, center + FILMSTRIP_WINDOW + 1);
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activePath]);

  if (photos.length < 2) return null;
  return (
    <nav aria-label="Dải ảnh" className={`shrink-0 border-t border-studio-line bg-[var(--studio-bg)] ${className}`}>
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:thin]">
        {visible.map((photo, offset) => {
          const index = start + offset;
          const active = index === activeIndex;
          return (
            <button
              key={photo.relPath}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(photo.relPath)}
              aria-label={`Ảnh ${index + 1}: ${photo.name}`}
              aria-current={active ? 'true' : undefined}
              title={`#${index + 1} ${photo.name}`}
              className={`relative h-12 w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-stone-800 transition ${
                active ? 'ring-2 ring-[var(--studio-accent)] ring-offset-2 ring-offset-[var(--studio-bg)]' : 'opacity-60 hover:opacity-100'
              }`}
            >
              <img src={`/api/thumbnail?path=${encodeURIComponent(photo.relPath)}`} alt="" loading="lazy" className="h-full w-full object-cover" />
              {photo.triage && (
                <span className={`absolute left-1 top-1 h-2 w-2 rounded-full ring-1 ring-black/40 ${FILMSTRIP_TRIAGE[photo.triage] || ''}`} aria-hidden="true" />
              )}
              {photo.isFavorite && (
                <Heart className="absolute right-1 top-1 h-2.5 w-2.5 fill-current text-red-400" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Lightbox({
  photos,
  retainedPhoto,
  retainedPhotoIndex = 0,
  activePhotoPath,
  onClose,
  onChangeActivePhoto,
  onToggleViewed,
  onToggleFavorite,
  onSaveNote,
  onOpenMoveModal,
  folders = [],
  onMovePhotos,
  isMoving = false,
  onOpenCompare,
  onOpenAnnotation,
  onSetTriage,
  virtualAlbums = {},
  onToggleAlbum,
  onUndo,
  canUndo = false,
  isCovered = false,
  collectionPhotos = [],
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef(null);
  const toolsRef = useRef(null);
  const toolsButtonRef = useRef(null);
  const dialogRef = useRef(null);
  // "Tự ẩn": after a few seconds without mouse or keys, fade the controls so only the photo shows.
  const [autoHide, setAutoHide] = useState(() => {
    try { return localStorage.getItem('wedding_lightbox_autohide') === 'true'; } catch { return false; }
  });
  const [idle, setIdle] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const viewportRef = useRef(null);
  const [rotation, setRotation] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [isEditingNote, setIsEditingNote] = useState(false);
  // Layers: thumbnail → screen-sized preview → original (only after zooming in).
  const [previewStatus, setPreviewStatus] = useState(null);
  const [originalStatus, setOriginalStatus] = useState(null);
  const [originalWantedPath, setOriginalWantedPath] = useState(null);
  const [autoAdvance, setAutoAdvance] = useState(() => {
    return localStorage.getItem('wedding_auto_advance') !== 'false';
  });

  const toggleAutoAdvance = () => {
    setAutoAdvance(prev => {
      const next = !prev;
      localStorage.setItem('wedding_auto_advance', String(next));
      return next;
    });
  };

  const lastPhotoRef = useRef(null);
  const lastIndexRef = useRef(0);
  const lastAutoMarkedPathRef = useRef(null);

  // Derive active photo by relPath (Fix for issue #4 and issue #1)
  const currentIndex = photos.findIndex(p => p.relPath === activePhotoPath);
  let photo = null;
  let safeIndex = 0;

  if (currentIndex !== -1) {
    photo = photos[currentIndex];
    safeIndex = currentIndex;
    lastIndexRef.current = currentIndex;
    lastPhotoRef.current = photo;
  } else if (retainedPhoto && retainedPhoto.relPath === activePhotoPath) {
    // The active photo may leave the current filter after a metadata change.
    photo = retainedPhoto;
    lastPhotoRef.current = photo;
    lastIndexRef.current = retainedPhotoIndex;
    safeIndex = Math.min(retainedPhotoIndex, Math.max(0, photos.length - 1));
  } else if (lastPhotoRef.current && lastPhotoRef.current.relPath === activePhotoPath) {
    photo = lastPhotoRef.current;
    safeIndex = Math.min(lastIndexRef.current, Math.max(0, photos.length - 1));
  } else if (photos.length > 0) {
    safeIndex = 0;
    photo = photos[0];
  }

  const previewReady = previewStatus?.path === photo?.relPath && previewStatus?.ready;
  const previewFailed = previewStatus?.path === photo?.relPath && !previewStatus?.ready;
  const originalReady = originalStatus?.path === photo?.relPath && originalStatus?.ready;
  const originalFailed = originalStatus?.path === photo?.relPath && !originalStatus?.ready;
  // Fetch the full-size original only when zooming in (or if the preview can't be made).
  const loadOriginal = Boolean(photo) && (originalWantedPath === photo.relPath || previewFailed);
  useEffect(() => {
    if (zoom > 1 && photo?.relPath) setOriginalWantedPath(photo.relPath);
  }, [zoom, photo?.relPath]);

  // Once this photo is on screen, have the server prepare the next few previews,
  // so stepping forward shows a ~0.8 MB image instead of decoding a 20–50 MB original.
  const warmedPreviewsRef = useRef(new Set());
  const upcomingPaths = useMemo(() => {
    const start = currentIndex < 0 ? safeIndex : currentIndex + 1;
    return photos.slice(start, start + 3).map(p => p.relPath).filter(path => path !== photo?.relPath);
  }, [photos, currentIndex, safeIndex, photo?.relPath]);
  useEffect(() => {
    if (!(previewReady || originalReady)) return;
    for (const path of upcomingPaths) {
      if (warmedPreviewsRef.current.has(path)) continue;
      warmedPreviewsRef.current.add(path);
      fetch(`${previewUrl(path)}&warm=1`).catch(() => warmedPreviewsRef.current.delete(path));
    }
  }, [previewReady, originalReady, upcomingPaths]);

  // Auto-mark as viewed ONLY when newly navigated/opened by user (not re-triggered when unviewed)
  useEffect(() => {
    if (activePhotoPath && lastAutoMarkedPathRef.current !== activePhotoPath) {
      lastAutoMarkedPathRef.current = activePhotoPath;
      if (currentIndex !== -1 && photo && !photo.isViewed && photo.relPath === activePhotoPath) {
        onToggleViewed(photo.relPath, true, false);
      }
    }
  }, [photo?.relPath, currentIndex, activePhotoPath, onToggleViewed]);

  // Sync note text and reset zoom/pan when changing photos
  useEffect(() => {
    if (photo) {
      setNoteText(photo.note || '');
      setIsEditingNote(false);
      gestureRef.current = null;
      setIsDragging(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
    }
  }, [photo?.relPath]);

  // Loupe Zoom 100% to Cursor toggle
  const handleToggleLoupe = useCallback((clientX, clientY) => {
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      const targetZoom = 2.5;
      if (viewportRef.current && clientX !== undefined && clientY !== undefined) {
        const rect = viewportRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const panX = -dx * (targetZoom - 1);
        const panY = -dy * (targetZoom - 1);
        setZoom(targetZoom);
        setPan({ x: panX, y: panY });
      } else {
        setZoom(targetZoom);
        setPan({ x: 0, y: 0 });
      }
    }
  }, [zoom]);

  const chromeHidden = autoHide && idle && !toolsOpen && !isEditingNote && !isCovered;
  useEffect(() => {
    if (!autoHide) {
      setIdle(false);
      return;
    }
    let timer;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    events.forEach(name => window.addEventListener(name, wake, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(name => window.removeEventListener(name, wake));
    };
  }, [autoHide]);
  const chromeClass = `transition-opacity duration-300 ${chromeHidden ? 'pointer-events-none opacity-0' : ''}`;

  const toggleAutoHide = () => {
    setAutoHide(value => {
      const next = !value;
      try { localStorage.setItem('wedding_lightbox_autohide', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      onChangeActivePhoto(photos[currentIndex - 1].relPath);
    } else if (currentIndex === -1 && photos.length > 0) {
      const prevIdx = Math.max(0, Math.min(lastIndexRef.current - 1, photos.length - 1));
      onChangeActivePhoto(photos[prevIdx].relPath);
    }
  }, [currentIndex, photos, onChangeActivePhoto]);

  const handleNext = useCallback(() => {
    if (currentIndex !== -1 && currentIndex < photos.length - 1) {
      onChangeActivePhoto(photos[currentIndex + 1].relPath);
    } else if (currentIndex === -1 && photos.length > 0) {
      const nextIdx = Math.min(lastIndexRef.current, photos.length - 1);
      onChangeActivePhoto(photos[nextIdx].relPath);
    }
  }, [currentIndex, photos, onChangeActivePhoto]);

  const handleTriage = useCallback((status) => {
    if (!photo || !onSetTriage) return;
    // Pressing the active rating again (button or 1/2/3) clears it.
    const nextStatus = status && photo.triage === status ? null : status;
    onSetTriage([photo.relPath], nextStatus);
    if (nextStatus && autoAdvance) {
      if ((currentIndex !== -1 && currentIndex < photos.length - 1) || (currentIndex === -1 && photos.length > 0)) {
        handleNext();
      }
    }
  }, [photo, onSetTriage, autoAdvance, currentIndex, photos.length, handleNext]);

  const comparisonPhoto = useMemo(() => {
    if (!photo) return undefined;
    if (photo.burstPhotos?.length > 1) return findBurstNeighbor(photo, photos, collectionPhotos);
    return currentIndex < 0 ? photos[safeIndex] : photos[safeIndex + 1] || photos[safeIndex - 1];
  }, [photo, photos, collectionPhotos, currentIndex, safeIndex]);

  const handleCompare = useCallback(() => {
    if (photo && (comparisonPhoto || photo.burstPhotos?.length > 1)) onOpenCompare?.(photo, comparisonPhoto);
  }, [photo, comparisonPhoto, onOpenCompare]);

  const toggleAlbum = useCallback((albumId) => {
    if (photo && virtualAlbums[albumId]) {
      onToggleAlbum?.(albumId, photo.relPath, !photo.albums?.includes(albumId));
    }
  }, [photo, virtualAlbums, onToggleAlbum]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  const changeZoom = (delta) => {
    const next = Math.min(4, Math.max(0.5, zoom + delta));
    setZoom(next);
    if (next <= 1) setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (event) => {
    if (!event.isPrimary) {
      gestureRef.current = null;
      setIsDragging(false);
      return;
    }
    if (event.button !== 0 || event.target.closest('button')) return;
    const panning = zoom > 1;
    if (!panning && event.pointerType !== 'touch') return;
    gestureRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan,
      panning,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (panning) setIsDragging(true);
  };

  const handlePointerMove = (event) => {
    const start = gestureRef.current;
    if (start?.id !== event.pointerId || !start.panning) return;
    setPan({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y });
  };

  const handlePointerCancel = (event) => {
    if (gestureRef.current?.id !== event.pointerId) return;
    gestureRef.current = null;
    setIsDragging(false);
  };

  const handlePointerUp = (event) => {
    const start = gestureRef.current;
    if (start?.id !== event.pointerId) return;
    handlePointerCancel(event);
    if (start.panning) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    if (dx < 0) handleNext();
    else handlePrev();
  };

  const dismissTools = useCallback(() => {
    setToolsOpen(false);
    setIsEditingNote(false);
    toolsButtonRef.current?.focus();
  }, []);

  const hasPhoto = Boolean(photo);
  useEffect(() => {
    if (!hasPhoto) return;
    const previous = document.activeElement;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, [hasPhoto]);

  useEffect(() => {
    if (!isCovered && hasPhoto && !dialogRef.current?.contains(document.activeElement)) {
      dialogRef.current?.focus({ preventScroll: true });
    }
  }, [hasPhoto, isCovered]);

  const keepFocusInDialog = (event) => {
    if (event.key !== 'Tab') return;
    const controls = event.currentTarget.querySelectorAll('button:not(:disabled), textarea');
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!toolsOpen || isCovered) return;
    const closeOutside = (event) => {
      if (!toolsRef.current?.contains(event.target)) {
        setToolsOpen(false);
        setIsEditingNote(false);
      }
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [toolsOpen, isCovered]);

  useEffect(() => {
    if (isCovered) return;
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (toolsOpen) dismissTools();
        else onClose();
        return;
      }
      const target = event.target;
      if (event.ctrlKey || event.metaKey || event.altKey
        || target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === ' ' && target.closest?.('button')) return;

      const key = event.key.toLowerCase();
      if (Object.hasOwn(ALBUM_SHORTCUTS, key)) {
        toggleAlbum(ALBUM_SHORTCUTS[key]);
        return;
      }

      switch (key) {
        case 'arrowleft':
        case 'h':
          handlePrev();
          break;
        case 'arrowright':
        case 'l':
        case ' ':
          handleNext();
          break;
        case '1':
        case 'p':
          handleTriage('pick');
          break;
        case '2':
          handleTriage('maybe');
          break;
        case '3':
        case 'x':
          handleTriage('reject');
          break;
        case '0':
          if (zoom > 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            handleTriage(null);
          }
          break;
        case 'u':
          handleTriage(null);
          break;
        case 'z':
          handleToggleLoupe();
          break;
        case 'v':
          if (photo) onToggleViewed(photo.relPath, !photo.isViewed);
          break;
        case 'f':
          if (photo) onToggleFavorite(photo.relPath, !photo.isFavorite);
          break;
        case 'r':
          setRotation(value => (value + 90) % 360);
          break;
        case 'k':
          handleCompare();
          break;
        case 'm':
          if (photo) {
            setToolsOpen(false);
            setIsEditingNote(false);
            onOpenMoveModal([photo.relPath]);
          }
          break;
        case '+':
        case '=':
          setZoom(value => Math.min(3, value + 0.25));
          break;
        case '-':
          setZoom(value => Math.max(0.5, value - 0.25));
          if (zoom <= 1.25) setPan({ x: 0, y: 0 });
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCovered, toolsOpen, dismissTools, onClose, toggleAlbum, handlePrev, handleNext, handleTriage, zoom,
    handleToggleLoupe, photo, onToggleViewed, onToggleFavorite, handleCompare, onOpenMoveModal]);

  if (!photo) return null;

  const originalUrl = `/api/original?path=${encodeURIComponent(photo.relPath)}`;
  const canCompare = onOpenCompare && (comparisonPhoto || photo.burstPhotos?.length > 1);
  const albums = Object.values(virtualAlbums);
  const showPrevious = currentIndex > 0 || (currentIndex < 0 && lastIndexRef.current > 0 && photos.length > 0);
  const showNext = currentIndex < photos.length - 1;
  const exif = photo.exif;
  const photoDetails = exif && [exif.camera, exif.focalLength, exif.aperture, exif.shutterSpeed, exif.iso && `ISO ${exif.iso}`].filter(Boolean);
  const annotationsCount = photo.annotations?.length || 0;

  const handleSaveNoteSubmit = (event) => {
    event.preventDefault();
    onSaveNote(photo.relPath, noteText);
    setIsEditingNote(false);
  };

  const openPhotoModal = (open) => {
    setToolsOpen(false);
    setIsEditingNote(false);
    open();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Xem ảnh"
      aria-modal={isCovered ? undefined : true}
      aria-hidden={isCovered ? true : undefined}
      inert={isCovered ? '' : undefined}
      tabIndex={-1}
      onKeyDown={keepFocusInDialog}
      className="theme-dark fixed inset-0 z-50 flex flex-col bg-[#100e12] text-stone-100"
    >
      <header className={`relative z-20 flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-studio-line bg-[var(--studio-panel)] px-2 py-2 sm:gap-x-4 sm:px-5 ${chromeClass}`}>
        <div className="min-w-[8rem] flex-1 px-1 sm:px-0">
          <h2 className="truncate text-sm font-semibold sm:text-base" title={photo.name}>{photo.name}</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-stone-400">
            {currentIndex >= 0 && <span className="shrink-0 font-mono">{safeIndex + 1} / {photos.length}</span>}
            {currentIndex < 0 && <span className="truncate">Ngoài bộ lọc hiện tại</span>}
            {photo.burstTotal >= 2 && <span className="hidden truncate sm:inline">· Loạt {photo.burstIndex}/{photo.burstTotal}</span>}
            {photo.isViewed && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-300" aria-label="Đã xem" />}
          </p>
        </div>

        {onMovePhotos && folders.length > 1 && (
          <MoveBar
            photo={photo}
            folders={folders}
            onMovePhotos={onMovePhotos}
            onOpenMoveModal={onOpenMoveModal}
            isMoving={isMoving}
            className="order-last w-full border-t border-studio-line/50 pt-1.5 lg:order-none lg:w-auto lg:max-w-[60%] lg:justify-end lg:border-t-0 lg:pt-0"
          />
        )}

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <button
            type="button"
            onClick={() => onToggleFavorite(photo.relPath, !photo.isFavorite)}
            className="studio-icon !h-10 !w-10"
            aria-label="Yêu thích"
            aria-pressed={Boolean(photo.isFavorite)}
            title="Yêu thích (F)"
          >
            <Heart className={`h-4 w-4 ${photo.isFavorite ? 'fill-current' : ''}`} />
          </button>
          {canCompare && (
            <button type="button" onClick={handleCompare} className="studio-icon !h-10 !w-10" aria-label="So sánh ảnh" title="So sánh ảnh (K)">
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleAutoHide}
            className="studio-icon !h-10 !w-10"
            aria-label="Tự ẩn thanh công cụ"
            aria-pressed={autoHide}
            title={autoHide ? 'Tắt tự ẩn thanh công cụ' : 'Tự ẩn thanh công cụ khi không dùng chuột'}
          >
            <EyeOff className="h-4 w-4" />
          </button>

          <div ref={toolsRef}>
            <button
              ref={toolsButtonRef}
              type="button"
              onClick={() => toolsOpen ? dismissTools() : setToolsOpen(true)}
              className="studio-icon !h-10 !w-10"
              aria-label="Công cụ ảnh"
              aria-expanded={toolsOpen}
              aria-controls={toolsOpen ? 'lightbox-photo-tools' : undefined}
              title="Công cụ ảnh"
            >
              <Ellipsis className="h-5 w-5" />
            </button>

            {toolsOpen && (
              <section
                id="lightbox-photo-tools"
                aria-label="Công cụ ảnh"
                className="absolute inset-x-2 top-full mt-2 max-h-[min(65dvh,34rem)] space-y-3 overflow-y-auto rounded-xl border border-studio-line bg-[var(--studio-panel)] p-3 shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[24rem]"
              >
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold text-stone-400">Khung nhìn · {Math.round(zoom * 100)}%</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    <PhotoTool icon={ZoomIn} label="Phóng to" onClick={() => changeZoom(0.25)} disabled={zoom >= 4} />
                    <PhotoTool icon={ZoomOut} label="Thu nhỏ" onClick={() => changeZoom(-0.25)} disabled={zoom <= 0.5} />
                    <PhotoTool icon={ZoomIn} label="Soi nét" pressed={zoom > 1} onClick={() => { handleToggleLoupe(); dismissTools(); }} />
                    <PhotoTool icon={RotateCw} label="Xoay ảnh" onClick={() => setRotation(value => (value + 90) % 360)} />
                    <PhotoTool icon={RotateCcw} label="Vừa khung" onClick={resetView} />
                    <PhotoTool
                      icon={photo.isViewed ? EyeOff : CheckCircle2}
                      label={photo.isViewed ? 'Đánh dấu chưa xem' : 'Đánh dấu đã xem'}
                      onClick={() => onToggleViewed(photo.relPath, !photo.isViewed)}
                    />
                  </div>
                </div>

                {onToggleAlbum && albums.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold text-stone-400">Gắn album</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {albums.map(album => (
                        <button
                          key={album.id}
                          type="button"
                          aria-pressed={Boolean(photo.albums?.includes(album.id))}
                          onClick={() => toggleAlbum(album.id)}
                          className="gallery-control !shrink"
                        >
                          <span className="min-w-0 break-words">{album.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <PhotoTool icon={Zap} label="Tự chuyển ảnh" pressed={autoAdvance} onClick={toggleAutoAdvance} />
                  {photo.triage && <PhotoTool icon={X} label="Xóa đánh giá" onClick={() => handleTriage(null)} />}
                  {onOpenMoveModal && <PhotoTool icon={FolderInput} label="Chuyển thư mục" onClick={() => openPhotoModal(() => onOpenMoveModal([photo.relPath]))} />}
                  {onOpenAnnotation && <PhotoTool icon={CircleDot} label={annotationsCount ? `Khoanh điểm (${annotationsCount})` : 'Khoanh điểm'} onClick={() => openPhotoModal(() => onOpenAnnotation(photo))} />}
                  {onSaveNote && !isEditingNote && <PhotoTool icon={MessageSquare} label="Ghi chú" onClick={() => setIsEditingNote(true)} />}
                </div>

                {isEditingNote ? (
                  <form onSubmit={handleSaveNoteSubmit} className="space-y-2">
                    <label className="block text-xs font-semibold text-stone-400" htmlFor="lightbox-note">Ghi chú chỉnh sửa</label>
                    <textarea
                      id="lightbox-note"
                      autoFocus
                      rows={2}
                      value={noteText}
                      onChange={event => setNoteText(event.target.value)}
                      className="w-full resize-y rounded-lg border border-studio-line bg-black/25 px-3 py-2 text-sm"
                    />
                    <div className="gallery-scroll-row">
                      {RETOUCH_PRESETS.map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          className="gallery-control !min-h-8"
                          onClick={() => setNoteText(current => [current.trim(), preset.text].filter(Boolean).join(', '))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="button" className="gallery-control" onClick={() => setIsEditingNote(false)}>Hủy</button>
                      <button type="submit" className="studio-primary">Lưu ghi chú</button>
                    </div>
                  </form>
                ) : photo.note && <p className="break-words text-xs text-stone-300">{photo.note}</p>}
                {photoDetails?.length > 0 && <p className="break-words text-[11px] text-stone-400">{photoDetails.join(' · ')}</p>}
              </section>
            )}
          </div>

          <button type="button" onClick={onClose} className="studio-icon !h-10 !w-10" aria-label="Đóng trình xem ảnh" title="Đóng (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onDoubleClick={event => {
          if (!event.target.closest('button')) handleToggleLoupe(event.clientX, event.clientY);
        }}
        className={`relative min-h-0 flex-1 select-none overflow-hidden ${
          zoom > 1 ? `touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}` : 'touch-pan-y cursor-zoom-in'
        } ${chromeHidden ? '!cursor-none' : ''}`}
      >
        <div className="absolute inset-0 flex items-center justify-center p-2 sm:px-14">
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
              transition: isDragging ? undefined : 'transform 150ms ease-out',
            }}
          >
            {/* Always mounted: changing its src keeps the last frame painted until the next
                thumbnail arrives, instead of flashing an empty viewport between photos. */}
            <img
              src={thumbnailUrl(photo.relPath)}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            />
            {!originalReady && (
              <img
                key={previewUrl(photo.relPath)}
                src={previewUrl(photo.relPath)}
                alt={photo.name}
                draggable={false}
                onLoad={event => markDecoded(event, setPreviewStatus, photo.relPath)}
                onError={() => setPreviewStatus({ path: photo.relPath, ready: false })}
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${previewReady ? '' : 'opacity-0'}`}
              />
            )}
            {loadOriginal && (
              <img
                key={originalUrl}
                src={originalUrl}
                alt={originalReady ? photo.name : ''}
                draggable={false}
                onLoad={event => markDecoded(event, setOriginalStatus, photo.relPath)}
                onError={() => setOriginalStatus({ path: photo.relPath, ready: false })}
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${originalReady ? '' : 'opacity-0'}`}
              />
            )}
          </div>
        </div>

        {showPrevious && (
          <button type="button" onClick={handlePrev} className={`studio-icon absolute left-1 top-1/2 -translate-y-1/2 bg-black/60 sm:left-3 ${chromeClass}`} aria-label="Ảnh trước" title="Ảnh trước (←)">
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {showNext && (
          <button type="button" onClick={handleNext} className={`studio-icon absolute right-1 top-1/2 -translate-y-1/2 bg-black/60 sm:right-3 ${chromeClass}`} aria-label="Ảnh tiếp theo" title="Ảnh tiếp theo (→)">
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
        {zoom !== 1 && (
          <button type="button" onClick={resetView} className="gallery-control absolute left-2 top-2 bg-black/75" aria-label="Trả về vừa khung">
            <RotateCcw className="h-3.5 w-3.5" /> {Math.round(zoom * 100)}%
          </button>
        )}
        {loadOriginal && !originalReady && !originalFailed && previewReady && (
          <p role="status" className="pointer-events-none absolute right-2 top-2 rounded bg-black/75 px-2 py-1 text-[11px] text-stone-300">
            Đang tải ảnh gốc…
          </p>
        )}
        {originalFailed && !previewReady && (
          <p role="status" className="pointer-events-none absolute inset-x-2 bottom-2 mx-auto w-fit rounded bg-black/75 px-3 py-1 text-xs">
            Không thể tải ảnh gốc.
          </p>
        )}
      </div>

      <Filmstrip photos={photos} activePath={photo.relPath} onSelect={onChangeActivePhoto} className={`hidden sm:block ${chromeClass}`} />

      {onSetTriage && (
        <footer className={`shrink-0 border-t border-studio-line bg-[var(--studio-panel)] px-2 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))] sm:px-4 ${chromeClass}`}>
          <div className="mx-auto flex max-w-xl items-center justify-center gap-1.5 sm:gap-2">
            {TRIAGE_ACTIONS.map(({ status, label, shortcut, icon: Icon, tone }) => (
              <button
                key={status}
                type="button"
                onClick={() => handleTriage(status)}
                aria-label={label}
                aria-pressed={photo.triage === status}
                title={photo.triage === status ? `Đang “${label}” — bấm lại (${shortcut}) để bỏ` : `${label} (${shortcut})`}
                className="gallery-control !min-h-11 min-w-0 !flex-1 !shrink justify-center whitespace-nowrap !px-1.5 sm:!px-2.5"
              >
                <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
                <span>{label}</span>
                <kbd className="hidden rounded border border-studio-line px-1 font-mono text-[10px] text-stone-400 sm:inline">{shortcut}</kbd>
              </button>
            ))}
            {onUndo && (
              <button type="button" onClick={onUndo} disabled={!canUndo} className="studio-icon !h-11 !w-9 sm:!w-10" aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z / Cmd+Z)">
                <Undo2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
