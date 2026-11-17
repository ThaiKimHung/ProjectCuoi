import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, ExternalLink, Files, HelpCircle, LoaderCircle, ScanSearch, X } from 'lucide-react';
import { fetchDuplicatePhotos, photoImageUrl } from '../api.js';

const GROUP_PAGE_SIZE = 8;
const PHOTO_PAGE_SIZE = 12;

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TRIAGE_BADGES = {
  pick: { label: 'Giữ lại', icon: Check, tone: 'bg-emerald-950/90 text-emerald-200 border-emerald-700/70' },
  maybe: { label: 'Cân nhắc', icon: HelpCircle, tone: 'bg-amber-950/90 text-amber-200 border-amber-700/70' },
  reject: { label: 'Bỏ qua', icon: X, tone: 'bg-stone-800/90 text-stone-300 border-stone-600/70' },
};

function DuplicateGroup({ photos, number, onCompare, photoByPath, onSetTriage, onKeepDuplicate }) {
  const [selected, setSelected] = useState(() => photos.slice(0, 2));
  const [visibleCount, setVisibleCount] = useState(PHOTO_PAGE_SIZE);

  const selectPhoto = (photo) => {
    setSelected(current => current.includes(photo)
      ? current.filter(item => item !== photo)
      : [...current.slice(-1), photo]);
  };

  return (
    <li className="rounded-xl border border-studio-line bg-black/15 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Nhóm {number} · {photos.length} ảnh</h4>
        <button
          type="button"
          disabled={selected.length !== 2}
          onClick={(event) => onCompare(selected[0], selected[1], event.currentTarget)}
          className="studio-primary"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          So sánh 2 ảnh
        </button>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {photos.slice(0, visibleCount).map(photo => {
          const selectedIndex = selected.indexOf(photo);
          const meta = photoByPath?.get(photo.relPath) || photo;
          const triage = meta.triage || null;
          const badge = triage ? TRIAGE_BADGES[triage] : null;
          const BadgeIcon = badge?.icon;
          const otherPaths = photos.filter(item => item.relPath !== photo.relPath).map(item => item.relPath);
          const isKeptOnly = triage === 'pick'
            && otherPaths.length > 0
            && otherPaths.every(relPath => (photoByPath?.get(relPath)?.triage || null) === 'reject');

          return (
            <li key={photo.relPath} className="flex min-w-0 flex-col rounded-lg border border-studio-line bg-[var(--studio-panel)]">
              <button
                type="button"
                aria-pressed={selectedIndex !== -1}
                onClick={() => selectPhoto(photo)}
                className="relative flex w-full flex-1 flex-col overflow-hidden rounded-lg border border-transparent text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-rose-200 aria-pressed:border-rose-300/50 aria-pressed:bg-rose-300/10"
              >
                <img
                  src={photoImageUrl('thumbnail', photo)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full bg-black/30 object-contain"
                />
                {selectedIndex !== -1 && (
                  <span aria-hidden="true" className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-rose-200 px-1.5 py-1 text-xs font-bold text-rose-950">
                    <Check className="h-3 w-3" />
                    {selectedIndex === 0 ? 'A' : 'B'}
                  </span>
                )}
                {badge && (
                  <span className={`absolute right-1.5 top-1.5 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${badge.tone}`}>
                    {BadgeIcon && <BadgeIcon className="h-3 w-3" aria-hidden="true" />}
                    {badge.label}
                  </span>
                )}
                <div className="flex w-full items-baseline justify-between gap-1.5 px-2 py-1.5">
                  <span className="break-all text-xs text-stone-100">{photo.relPath}</span>
                  {photo.size > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-stone-400">{formatFileSize(photo.size)}</span>
                  )}
                </div>
              </button>

              {(onKeepDuplicate || onSetTriage) && (
                <div className="flex flex-wrap items-center gap-1 px-2 pt-1">
                  {onKeepDuplicate && otherPaths.length > 0 && (
                    <button
                      type="button"
                      aria-pressed={isKeptOnly}
                      onClick={() => onKeepDuplicate(photo.relPath, otherPaths)}
                      className={`inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                        isKeptOnly
                          ? 'border-emerald-500/60 bg-emerald-950 text-emerald-200'
                          : 'border-studio-line bg-black/25 text-stone-200 hover:border-emerald-500/50 hover:text-emerald-200'
                      }`}
                      title="Đặt ảnh này là Giữ lại và đánh dấu Bỏ qua các bản còn lại trong nhóm"
                    >
                      <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                      Chỉ giữ bản này
                    </button>
                  )}
                  {onSetTriage && (
                    <>
                      <button
                        type="button"
                        aria-pressed={triage === 'pick'}
                        onClick={() => onSetTriage([photo.relPath], triage === 'pick' ? null : 'pick')}
                        className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                          triage === 'pick'
                            ? 'border-emerald-500/60 bg-emerald-950 text-emerald-200'
                            : 'border-studio-line bg-black/25 text-stone-300 hover:text-white'
                        }`}
                        title="Đánh dấu Giữ lại"
                      >
                        Giữ
                      </button>
                      <button
                        type="button"
                        aria-pressed={triage === 'reject'}
                        onClick={() => onSetTriage([photo.relPath], triage === 'reject' ? null : 'reject')}
                        className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                          triage === 'reject'
                            ? 'border-stone-500 bg-stone-800 text-stone-200'
                            : 'border-studio-line bg-black/25 text-stone-300 hover:text-white'
                        }`}
                        title="Đánh dấu Bỏ qua"
                      >
                        Bỏ qua
                      </button>
                    </>
                  )}
                </div>
              )}

              <a
                href={photoImageUrl('original', photo)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Mở ảnh gốc ${photo.relPath} trong thẻ mới`}
                className="mx-2 mb-2 mt-1 inline-flex min-h-7 items-center gap-1 self-start text-xs text-rose-200 hover:text-white hover:underline"
              >
                Mở ảnh gốc <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
      {visibleCount < photos.length && (
        <button type="button" onClick={() => setVisibleCount(count => count + PHOTO_PAGE_SIZE)} className="gallery-control mt-3">
          Xem thêm ảnh ({photos.length - visibleCount})
        </button>
      )}
    </li>
  );
}

function DuplicateResults({ result, onCompare, photoByPath, onSetTriage, onKeepDuplicate }) {
  const { exactGroups, similarGroups, scannedCount, skippedCount, visualSkippedCount = 0 } = result;
  const [showSimilar, setShowSimilar] = useState(() => exactGroups.length === 0 && similarGroups.length > 0);
  const [visibleGroups, setVisibleGroups] = useState(GROUP_PAGE_SIZE);
  const groups = showSimilar ? similarGroups : exactGroups;

  const selectCategory = (similar) => {
    if (similar === showSimilar) return;
    setShowSimilar(similar);
    setVisibleGroups(GROUP_PAGE_SIZE);
  };

  return (
    <>
      <p className="text-sm text-stone-300" role="status">
        Đã quét {scannedCount} ảnh.
        {skippedCount > 0 && ` Bỏ qua ${skippedCount} mục không thể đọc an toàn.`}
        {visualSkippedCount > 0 && ` Có ${visualSkippedCount} ảnh thiếu dấu vân tay hình ảnh.`}
      </p>
      {exactGroups.length + similarGroups.length === 0 ? (
        <div className="mt-4 rounded-xl border border-studio-line bg-black/15 px-4 py-7 text-center text-sm text-stone-200">
          {scannedCount ? 'Chưa tìm thấy ảnh trùng hệt hoặc ảnh tương tự.' : 'Chưa có ảnh để đối chiếu trong bộ ảnh này.'}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Loại kết quả">
            <button type="button" aria-pressed={!showSimilar} onClick={() => selectCategory(false)} className="gallery-control">
              Ảnh trùng hệt ({exactGroups.length})
            </button>
            <button type="button" aria-pressed={showSimilar} onClick={() => selectCategory(true)} className="gallery-control">
              Ảnh tương tự ({similarGroups.length})
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-stone-300">
            {showSimilar
              ? 'Gợi ý dựa trên hình ảnh. Có thể bỏ sót hoặc gợi ý nhầm. Hãy xem từng cặp trước khi quyết định.'
              : 'Các tệp trong mỗi nhóm có nội dung giống hệt từng byte.'}
            {groups.length > 0 && ' Chạm vào ảnh để đổi cặp so sánh hoặc chọn ngay bản muốn giữ.'}
          </p>
          {groups.length === 0 && <p className="mt-4 text-sm text-stone-400">Không tìm thấy nhóm nào trong mục này.</p>}
          <ol key={String(showSimilar)} className="mt-3 space-y-3">
            {groups.slice(0, visibleGroups).map((photos, index) => (
              <DuplicateGroup
                key={photos[0].relPath}
                photos={photos}
                number={index + 1}
                onCompare={onCompare}
                photoByPath={photoByPath}
                onSetTriage={onSetTriage}
                onKeepDuplicate={onKeepDuplicate}
              />
            ))}
          </ol>
          {visibleGroups < groups.length && (
            <button type="button" onClick={() => setVisibleGroups(count => count + GROUP_PAGE_SIZE)} className="gallery-control mt-3">
              Xem thêm nhóm ({groups.length - visibleGroups})
            </button>
          )}
        </>
      )}
    </>
  );
}

export function DuplicatePhotosModal({
  isOpen,
  isCovered = false,
  onClose,
  onCompare,
  photos = [],
  onSetTriage,
  onKeepDuplicate,
}) {
  const [scan, setScan] = useState({ status: 'idle' });
  const requestRef = useRef(null);
  const dialogRef = useRef(null);
  const compareButtonRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const photoByPath = useMemo(() => new Map(photos.map(photo => [photo.relPath, photo])), [photos]);

  useEffect(() => {
    if (!isOpen) {
      setScan({ status: 'idle' });
      return;
    }
    const previous = document.activeElement;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      compareButtonRef.current = null;
      previous?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isCovered && isOpen && compareButtonRef.current) {
      compareButtonRef.current.focus({ preventScroll: true });
      compareButtonRef.current = null;
    }
  }, [isCovered, isOpen]);

  const startScan = async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setScan({ status: 'scanning' });
    try {
      const result = await fetchDuplicatePhotos(controller.signal);
      if (requestRef.current === controller) setScan({ status: 'done', result });
    } catch (error) {
      if (requestRef.current === controller) setScan({ status: 'error', error: error.message });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const cancelScan = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setScan({ status: 'cancelled' });
  };

  const handleCompare = (first, second, button) => {
    compareButtonRef.current = button;
    onCompare(first, second);
  };

  const handleKeyDown = (event) => {
    if (isCovered) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const controls = event.currentTarget.querySelectorAll('button:not(:disabled), a[href]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || focused === event.currentTarget)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  if (!isOpen) return null;
  const isScanning = scan.status === 'scanning';
  return (
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={isCovered ? undefined : true}
        aria-hidden={isCovered ? true : undefined}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        inert={isCovered ? '' : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-studio-line bg-[var(--studio-panel)] text-stone-50 shadow-2xl outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-studio-line px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="studio-logo">
              <Files className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id={titleId} className="text-base font-semibold">Tìm ảnh trùng</h2>
              <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-stone-300">
                Quét chỉ đọc trong bộ ảnh hiện tại và các thư mục con.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng cửa sổ tìm ảnh trùng" className="studio-icon">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
          {scan.status === 'idle' && (
            <p className="text-sm text-stone-300">Tìm bản sao y hệt và các ảnh có hình ảnh tương tự để đối chiếu cạnh nhau.</p>
          )}
          {isScanning && (
            <p className="flex items-center gap-2 text-sm text-stone-200" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin text-rose-200" aria-hidden="true" />
              Đang quét bộ ảnh. Bộ ảnh lớn có thể cần thêm thời gian.
            </p>
          )}
          {scan.status === 'cancelled' && <p className="text-sm text-stone-300" role="status">Đã dừng quét.</p>}
          {scan.status === 'error' && <p className="text-sm text-rose-200" role="alert">Không thể quét bộ ảnh. {scan.error}</p>}
          {scan.status === 'done' && (
            <DuplicateResults
              result={scan.result}
              onCompare={handleCompare}
              photoByPath={photoByPath}
              onSetTriage={onSetTriage}
              onKeepDuplicate={onKeepDuplicate}
            />
          )}
        </div>
        <footer className="flex shrink-0 justify-end border-t border-studio-line px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={isScanning ? cancelScan : startScan}
            className={isScanning ? 'gallery-control' : 'studio-primary'}
          >
            {!isScanning && <ScanSearch className="h-4 w-4" aria-hidden="true" />}
            {isScanning ? 'Dừng quét' : scan.status === 'idle' ? 'Bắt đầu quét' : 'Quét lại'}
          </button>
        </footer>
      </div>
    </div>
  );
}
