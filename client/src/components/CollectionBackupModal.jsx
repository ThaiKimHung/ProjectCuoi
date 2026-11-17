import React, { useEffect, useId, useRef, useState } from 'react';
import { Archive, Check, Download, FileUp, X } from 'lucide-react';
import { downloadCollectionBackup, previewCollectionBackup, restoreCollectionBackup } from '../api.js';

const backupLimit = 9 * 1024 * 1024;
const oversizedBackup = 'Bản sao lưu vượt quá giới hạn 9 MiB.';
const checkpointLabels = {
  restored: 'Sẽ khôi phục điểm duyệt từ bản sao lưu.',
  kept: 'Giữ điểm duyệt hiện tại.',
  skipped: 'Bỏ qua điểm duyệt vì thiếu ảnh tương ứng.',
  same: 'Điểm duyệt đã trùng khớp.',
};

function describeAlbumConflict(conflict) {
  switch (conflict.kind) {
    case 'quota':
      return `Giữ chỉ tiêu ${conflict.currentQuota} ảnh của “${conflict.targetName}” (bản sao lưu: ${conflict.incomingQuota}).`;
    case 'sameName':
      return `Thêm ảnh từ “${conflict.sourceName}” vào album cùng tên “${conflict.targetName}”.`;
    case 'sameId':
      return `Tạo album riêng “${conflict.sourceName}” vì mã album gốc đã được sử dụng.`;
    default:
      return null;
  }
}

function RestoreReview({ summary }) {
  const conflicts = summary.photoFieldConflicts + summary.albumConflicts.length + Number(summary.checkpoint === 'kept');
  const counts = [
    ['Ảnh khớp', summary.matchedPhotos],
    ['Ảnh bỏ qua', summary.skippedPhotos],
    ['Mục trùng hoặc khác', conflicts],
  ];

  return (
    <div className="space-y-3 rounded-xl border border-studio-line bg-black/10 p-4">
      <div className="grid grid-cols-3 gap-2">
        {counts.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-studio-line px-2.5 py-2">
            <div className="text-lg font-semibold tabular-nums text-white">{value}</div>
            <div className="text-xs leading-tight text-stone-300">{label}</div>
          </div>
        ))}
      </div>
      <ul className="space-y-1.5 text-xs leading-relaxed text-stone-300">
        <li>{summary.photoFieldsAdded} mục dữ liệu ảnh sẽ được bổ sung.</li>
        {summary.photoFieldConflicts > 0 && (
          <li>Giữ {summary.photoFieldConflicts} mục dữ liệu hiện có trên {summary.conflictingPhotos} ảnh.</li>
        )}
        {(summary.albumsCreated > 0 || summary.albumMembershipsAdded > 0 || summary.albumQuotasRestored > 0) && (
          <li>
            Tạo {summary.albumsCreated} album, thêm {summary.albumMembershipsAdded} lượt ảnh vào album
            {summary.albumQuotasRestored > 0 ? ` và khôi phục ${summary.albumQuotasRestored} chỉ tiêu` : ''}.
          </li>
        )}
        {checkpointLabels[summary.checkpoint] && <li>{checkpointLabels[summary.checkpoint]}</li>}
      </ul>
      {summary.skippedPaths.length > 0 && (
        <details className="text-xs text-stone-300">
          <summary className="cursor-pointer font-medium text-stone-200">Đường dẫn ảnh bị bỏ qua</summary>
          <ul className="mt-1 max-h-28 list-disc space-y-1 overflow-auto break-all pl-5 font-mono">
            {summary.skippedPaths.map(path => <li key={path}>{path}</li>)}
          </ul>
          {summary.skippedPhotos > summary.skippedPaths.length && (
            <p className="mt-1">Và {summary.skippedPhotos - summary.skippedPaths.length} đường dẫn khác.</p>
          )}
        </details>
      )}
      {summary.albumConflicts.length > 0 && (
        <details className="text-xs text-stone-300">
          <summary className="cursor-pointer font-medium text-stone-200">Cách xử lý album trùng</summary>
          <ul className="mt-1 max-h-28 list-disc space-y-1 overflow-auto break-words pl-5">
            {summary.albumConflicts.map((conflict, index) => (
              <li key={index}>{describeAlbumConflict(conflict)}</li>
            ))}
          </ul>
        </details>
      )}
      {summary.changes === 0 && (
        <p className="text-xs font-medium text-amber-200">Không có dữ liệu mới để khôi phục.</p>
      )}
    </div>
  );
}

function BackupDialog({ collectionId, onClose, onRestored }) {
  const dialog = useRef(null);
  const mounted = useRef(false);
  const titleId = useId();
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    mounted.current = true;
    return () => {
      mounted.current = false;
      element.close();
    };
  }, []);

  const requestPreview = async fileDraft => {
    const result = await previewCollectionBackup(fileDraft.backup, collectionId);
    if (mounted.current) setPreview(result);
  };

  const run = async (operation, action) => {
    setPending(operation);
    setError('');
    try {
      await action();
    } catch (requestError) {
      if (!mounted.current) return;
      if (requestError.status === 409) setPreview(null);
      setError(requestError.status === 413
        ? oversizedBackup
        : requestError.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
    } finally {
      if (mounted.current) setPending('');
    }
  };

  const handleDownload = () => run('download', async () => {
    const backup = await downloadCollectionBackup(collectionId);
    if (!mounted.current) return;
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    if (blob.size > backupLimit) throw new Error(oversizedBackup);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wedding-curator-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const handleFile = event => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    setDraft(null);
    setPreview(null);
    setRestored(false);
    run('preview', async () => {
      if (file.size > backupLimit) throw new Error(oversizedBackup);
      const contents = await file.text();
      let backup;
      try {
        backup = JSON.parse(contents);
      } catch {
        throw new Error('Tệp đã chọn không phải JSON hợp lệ.');
      }
      if (!mounted.current) return;
      if (new Blob([JSON.stringify(backup)]).size > backupLimit) throw new Error(oversizedBackup);
      const fileDraft = { name: file.name, backup };
      setDraft(fileDraft);
      await requestPreview(fileDraft);
    });
  };

  const handleRestore = () => run('restore', async () => {
    const result = await restoreCollectionBackup(draft.backup, collectionId, preview.previewToken);
    if (!mounted.current) return;
    setRestored(true);
    try {
      await onRestored(result);
    } catch {
      if (mounted.current) setError('Dữ liệu đã được khôi phục. Hãy tải lại trang để xem các thay đổi.');
    }
  });

  const working = Boolean(pending);
  const locked = pending === 'restore';

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-studio-line bg-[var(--studio-panel)] p-0 text-stone-100 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-studio-line px-5 py-4">
          <div className="rounded-xl bg-rose-400/10 p-2.5 text-rose-300">
            <Archive className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold text-white">Sao lưu và khôi phục</h2>
          <button
            type="button"
            aria-label="Đóng sao lưu và khôi phục"
            disabled={locked}
            onClick={onClose}
            className="rounded-lg p-2 text-stone-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="space-y-5 overflow-y-auto px-5 py-5">
          <section className="flex flex-wrap items-start justify-between gap-3 border-b border-studio-line pb-5">
            <div className="max-w-xs space-y-1">
              <h3 className="text-sm font-semibold text-white">Sao lưu bộ ảnh đang mở</h3>
              <p className="text-xs leading-relaxed text-stone-300">
                Tệp JSON lưu dấu đã xem, yêu thích, phân loại, album và chỉ tiêu, ghi chú, đánh dấu trên ảnh
                và điểm duyệt. Ảnh gốc được lưu riêng.
              </p>
            </div>
            <button
              type="button"
              disabled={working}
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg border border-studio-line px-3 py-2 text-xs font-semibold text-stone-100 hover:bg-white/10 disabled:opacity-40"
            >
              <Download className="h-4 w-4 text-rose-300" aria-hidden="true" />
              {pending === 'download' ? 'Đang tạo tệp…' : 'Tải bản sao lưu'}
            </button>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">Khôi phục vào bộ ảnh đang mở</h3>
              <p className="text-xs leading-relaxed text-stone-300">
                Dữ liệu ảnh được ghép theo đúng đường dẫn trong thư mục đang mở. Dữ liệu và điểm duyệt hiện có
                được ưu tiên. Ảnh khớp được thêm vào album, chỉ tiêu hiện tại được giữ khi bộ ảnh đã có chỉnh sửa.
              </p>
            </div>
            <label className="flex cursor-pointer flex-wrap items-center gap-2 text-xs font-medium text-stone-200">
              <FileUp className="h-4 w-4 text-rose-300" aria-hidden="true" />
              <span>Chọn bản sao lưu JSON (tối đa 9 MiB)</span>
              <input
                type="file"
                accept=".json,application/json"
                disabled={working}
                onChange={handleFile}
                className="w-full min-w-0 rounded-lg border border-studio-line p-1.5 text-xs text-stone-300 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1.5 file:font-medium file:text-white hover:file:bg-white/20 disabled:opacity-50"
              />
            </label>
            {draft && <p className="break-all text-xs text-stone-400">{draft.name}</p>}
            {pending === 'preview' && <p role="status" className="text-xs text-stone-300">Đang đối chiếu với bộ ảnh…</p>}
            {restored ? (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-400/10 p-3 text-sm text-emerald-200">
                <Check className="h-4 w-4" aria-hidden="true" /> Đã khôi phục dữ liệu bộ ảnh.
              </p>
            ) : preview && <RestoreReview summary={preview.summary} />}
            {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-200">{error}</p>}
            {draft && !preview && !working && !restored && (
              <button
                type="button"
                onClick={() => run('preview', () => requestPreview(draft))}
                className="rounded-lg border border-studio-line px-3 py-2 text-xs font-semibold text-stone-100 hover:bg-white/10"
              >
                Kiểm tra lại bản sao lưu
              </button>
            )}
          </section>
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-studio-line px-5 py-3">
          <button
            type="button"
            disabled={locked}
            onClick={onClose}
            className="rounded-lg border border-studio-line px-3.5 py-2 text-xs font-semibold text-stone-200 hover:bg-white/10 disabled:opacity-40"
          >
            {restored ? 'Xong' : 'Đóng'}
          </button>
          {preview && !restored && (
            <button
              type="button"
              disabled={working || preview.summary.changes === 0}
              onClick={handleRestore}
              className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-paper hover:bg-rose-500 disabled:opacity-40"
            >
              {locked ? 'Đang khôi phục…' : 'Xác nhận khôi phục'}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}

export function CollectionBackupModal({ isOpen, onClose, collectionId, onRestored }) {
  return isOpen && collectionId
    ? <BackupDialog key={collectionId} {...{ collectionId, onClose, onRestored }} />
    : null;
}
