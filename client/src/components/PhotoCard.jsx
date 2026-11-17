import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, CheckCircle2, Circle, Folder, Heart, HelpCircle, MessageSquare, Target, X } from 'lucide-react';
import { findBurstNeighbor } from '../photoBurst.js';

// tone: badge under the photo (light theme). solid: pressed button drawn on the photo.
const TRIAGE_ACTIONS = [
  { id: 'pick', label: 'Giữ lại', shortcut: '1', icon: Check, tone: 'bg-emerald-950 text-emerald-200', solid: 'bg-emerald-600 text-paper' },
  { id: 'maybe', label: 'Cân nhắc', shortcut: '2', icon: HelpCircle, tone: 'bg-amber-950 text-amber-200', solid: 'bg-amber-700 text-paper' },
  { id: 'reject', label: 'Bỏ qua', shortcut: '3', icon: X, tone: 'bg-stone-800 text-stone-300', solid: 'bg-black/90 text-paper' },
];

export function PhotoCard({
  photo,
  position,
  showFolder = true,
  allPhotos,
  collectionPhotos,
  isSelected,
  isCursor = false,
  observePhoto,
  onToggleSelect,
  onOpenLightbox,
  onToggleViewed,
  onToggleFavorite,
  onSetTriage,
  onOpenCompare,
  virtualAlbums,
  selectedFiles,
}) {
  const cardRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  // Keep the opener and metadata mounted so the card stays in the tab order
  // and the grid retains its exact scroll geometry before the thumbnail loads.
  const showMedia = !observePhoto || nearViewport || hasFocus || isCursor;

  useEffect(() => observePhoto?.(cardRef.current, setNearViewport), [observePhoto]);

  const triage = TRIAGE_ACTIONS.find(action => action.id === photo.triage);
  const TriageIcon = triage?.icon;
  const folderName = photo.folder || 'Thư mục gốc';
  // In "Tất cả ảnh" only photos inside a subfolder name it; root photos need no label.
  const folderTag = showFolder && photo.folder && photo.folder !== 'Thư mục gốc';
  const hasTags = folderTag || triage || photo.albums?.length > 0;

  const handleDragStart = (e) => {
    const files = isSelected && selectedFiles.length > 0 ? selectedFiles : [photo.relPath];
    e.dataTransfer.setData('application/json', JSON.stringify({ files }));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleCompareBurst = () => {
    const neighbor = findBurstNeighbor(photo, allPhotos, collectionPhotos);
    onOpenCompare?.(photo, neighbor);
  };

  return (
    <article
      ref={cardRef}
      data-photo-path={photo.relPath}
      data-selected={isSelected}
      data-cursor={isCursor}
      draggable
      onDragStart={handleDragStart}
      onFocus={() => setHasFocus(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
      }}
      className={`photo-card group flex min-w-0 select-none flex-col overflow-hidden rounded-xl border bg-[var(--studio-panel)] transition ${
        isSelected ? 'border-rose-500 ring-2 ring-rose-500' : 'border-studio-line hover:border-stone-600 hover:shadow-md'
      }`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-stone-800">
        <button
          type="button"
          onClick={onOpenLightbox}
          className="photo-open absolute inset-0 w-full"
          aria-label={`Mở ảnh ${photo.name}`}
        >
          {showMedia && (
            <img
              src={`/api/thumbnail?path=${encodeURIComponent(photo.relPath)}`}
              alt={photo.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </button>

        {showMedia && <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5 sm:p-2">
          <div className="photo-hover flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleSelect}
              className="photo-icon"
              aria-label={`Chọn ảnh ${photo.name}`}
              aria-pressed={isSelected}
              title={isSelected ? 'Bỏ chọn ảnh' : 'Chọn ảnh · Shift + click để chọn một dải'}
            >
              {isSelected ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            </button>

            {photo.burstTotal >= 2 && (
              <button
                type="button"
                onClick={handleCompareBurst}
                className="pointer-events-auto flex h-7 shrink-0 items-center gap-1 rounded-full bg-black/55 px-2 text-[10px] font-medium text-paper backdrop-blur-sm hover:bg-black/75"
                aria-label={`So sánh ảnh chụp liên tiếp ${photo.burstIndex}/${photo.burstTotal}`}
                title="So sánh ảnh chụp liên tiếp"
              >
                <Camera className="hidden h-3 w-3 sm:block" />
                {photo.burstIndex}/{photo.burstTotal}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleViewed(photo.relPath, !photo.isViewed)}
              className="photo-icon photo-hover"
              aria-label={`Đánh dấu ${photo.isViewed ? 'chưa xem' : 'đã xem'} ${photo.name}`}
              aria-pressed={photo.isViewed}
              title={photo.isViewed ? 'Đánh dấu chưa xem' : 'Đánh dấu đã xem'}
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onToggleFavorite(photo.relPath, !photo.isFavorite)}
              className={`photo-icon ${photo.isFavorite ? '!bg-paper !text-red-600' : 'photo-hover'}`}
              aria-label={`Yêu thích ${photo.name}`}
              aria-pressed={photo.isFavorite}
              title={photo.isFavorite ? 'Bỏ yêu thích' : 'Yêu thích'}
            >
              <Heart className={`h-3.5 w-3.5 ${photo.isFavorite ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>}

        {showMedia && onSetTriage && (
          <div className="photo-triage pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
            {TRIAGE_ACTIONS.map(({ id, label, shortcut, icon: Icon, solid }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSetTriage([photo.relPath], photo.triage === id ? null : id)}
                aria-pressed={photo.triage === id}
                aria-label={`${label} ${photo.name}`}
                title={`${label} (phím ${shortcut})`}
                className={`pointer-events-auto flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-semibold backdrop-blur-sm ${
                  photo.triage === id ? `${solid} ring-1 ring-paper/70` : 'bg-black/55 text-paper hover:bg-black/75'
                }`}
              >
                <Icon className="h-3 w-3" />
                {shortcut}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5 px-2.5 py-2 sm:px-3">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-stone-100" title={photo.name}>
          {!photo.isViewed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" title="Chưa xem" aria-label="Chưa xem" />}
          {position != null && <span className="shrink-0 font-mono text-[10px] text-stone-500" title="Số thứ tự (STT)">#{position}</span>}
          <span className="truncate">{photo.name}</span>
        </p>
        {hasTags && (
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-stone-400">
            {triage && (
              <span className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${triage.tone}`}>
                <TriageIcon className="h-3 w-3" />
                {triage.label}
              </span>
            )}
            {photo.albums?.map(albumId => {
              const name = virtualAlbums[albumId]?.name || albumId;
              return <span key={albumId} className="max-w-full truncate rounded-full bg-rose-950 px-1.5 py-0.5 text-rose-200" title={name}>{name}</span>;
            })}
            {folderTag && (
              <span className="flex min-w-0 items-center gap-1" title={folderName}>
                <Folder className="h-3 w-3 shrink-0" />
                <span className="truncate">{folderName}</span>
              </span>
            )}
          </div>
        )}
        {(photo.note || photo.annotations?.length > 0) && (
          <div className="flex items-center gap-2 text-[10px] text-stone-400">
            {photo.note && (
              <span className="flex min-w-0 items-center gap-1" title={photo.note}>
                <MessageSquare className="h-3 w-3 shrink-0" />
                <span className="truncate">{photo.note}</span>
              </span>
            )}
            {photo.annotations?.length > 0 && (
              <span className="flex shrink-0 items-center gap-1" title={`${photo.annotations.length} vị trí retouch`}>
                <Target className="h-3 w-3" />
                {photo.annotations.length}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
