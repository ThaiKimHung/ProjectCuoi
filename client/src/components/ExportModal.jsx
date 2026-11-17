import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  X, Copy, Check, Download, FolderPlus, 
  Sparkles, FileText, CheckCircle2,
  Package, AlertTriangle, Edit3, ChevronDown
} from 'lucide-react';
import { copyPhotosToExport, exportCategorizedPackage, updateAlbumQuota } from '../api.js';
import { buildStudioPackage } from './studioPackagePreview.js';
import { DialogShell } from './DialogShell.jsx';

const emptyAlbums = {};

function PackageThumbnails({ photos, description, defaultExpanded = false }) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  return (
    <>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Thu gọn ảnh' : `Xem ${photos.length} ảnh`} ${description}`}
        onClick={() => setIsExpanded(previous => !previous)}
        className="flex items-center gap-1.5 py-1 text-xs font-medium text-rose-300 hover:text-rose-100"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        {isExpanded ? 'Thu gọn ảnh' : `Xem ${photos.length} ảnh`}
      </button>
      {isExpanded && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
          {photos.map(photo => (
            <li key={photo.relPath} title={photo.relPath} className="min-w-0 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden">
              <img
                src={`/api/thumbnail?path=${encodeURIComponent(photo.relPath)}`}
                alt={photo.name}
                loading="lazy"
                decoding="async"
                className="w-full aspect-[4/3] object-contain bg-slate-950"
              />
              <div className="px-2 py-1.5">
                <p className="text-xs text-slate-200 truncate">{photo.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{photo.folder || 'Thư mục gốc'}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ExportModal({
  isOpen,
  onClose,
  allPhotos = [],
  selectedPhotos = [],
  favoritePhotos = [],
  viewedPhotos = [],
  virtualAlbums = emptyAlbums,
  isLoadingPackagePhotos = false,
  packagePhotosError = null,
  onRetryPackagePhotos,
  onSuccessToast,
  onRefreshTree,
}) {
  const [activeTab, setActiveTab] = useState('package'); // 'package' | 'custom'
  const [isReviewingPackage, setIsReviewingPackage] = useState(false);
  const [includedCustomAlbumIds, setIncludedCustomAlbumIds] = useState([]);
  const bodyRef = useRef(null);
  const [scope, setScope] = useState('favorites'); // 'favorites' | 'selected' | 'viewed' | 'all'
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeFolders, setIncludeFolders] = useState(false);
  const [exportFolderName, setExportFolderName] = useState('Gui_Studio_In');
  const [packageFolderName, setPackageFolderName] = useState(() => {
    return `Xuat_Anh_Cuoi_${new Date().toISOString().slice(0, 10)}`;
  });

  const [isExporting, setIsExporting] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [exportReport, setExportReport] = useState(null);

  // Quota editing state
  const [editingQuotaId, setEditingQuotaId] = useState(null);
  const [editingQuotaVal, setEditingQuotaVal] = useState('');
  const [localAlbums, setLocalAlbums] = useState(virtualAlbums);
  const isPackageReady = !isLoadingPackagePhotos && !packagePhotosError;

  useEffect(() => {
    setLocalAlbums(virtualAlbums);
  }, [virtualAlbums]);

  useEffect(() => {
    if (!isOpen) {
      setIsReviewingPackage(false);
      setIncludedCustomAlbumIds([]);
      setEditingQuotaId(null);
    }
  }, [isOpen]);

  // Set initial scope based on context
  useEffect(() => {
    if (selectedPhotos.length > 0) {
      setScope('selected');
    } else if (favoritePhotos.length > 0) {
      setScope('favorites');
    } else {
      setScope('all');
    }
  }, [isOpen, selectedPhotos.length, favoritePhotos.length]);

  // Determine current active list of photos for Custom mode
  const targetPhotos = useMemo(() => {
    if (scope !== 'selected' && !isPackageReady) return [];
    switch (scope) {
      case 'selected':
        return selectedPhotos;
      case 'favorites':
        return favoritePhotos;
      case 'viewed':
        return viewedPhotos;
      case 'all':
      default:
        return allPhotos;
    }
  }, [scope, isPackageReady, selectedPhotos, favoritePhotos, viewedPhotos, allPhotos]);

  // Generate exported text
  const exportedText = useMemo(() => {
    return targetPhotos.map((p) => {
      let line = includeFolders ? p.relPath : p.name;
      if (includeNotes && p.note) {
        line += ` - [Ghi chú: ${p.note}]`;
      }
      return line;
    }).join('\n');
  }, [targetPhotos, includeNotes, includeFolders]);

  const { groups, setupGroups, categories, unassignedPicks } = useMemo(
    () => buildStudioPackage(allPhotos, localAlbums, includedCustomAlbumIds),
    [allPhotos, localAlbums, includedCustomAlbumIds],
  );
  if (!isOpen) return null;
  const visibleGroups = isReviewingPackage
    ? [...groups.filter(group => group.photos.length > 0), ...groups.filter(group => group.photos.length === 0)]
    : setupGroups;

  // Handle saving quota adjustment
  const handleSaveQuota = async ({ id, albumId = id }) => {
    const val = parseInt(editingQuotaVal, 10);
    if (isNaN(val) || val < 0) {
      setEditingQuotaId(null);
      return;
    }
    try {
      await updateAlbumQuota(albumId, val);
      setLocalAlbums(prev => ({
        ...prev,
        [albumId]: {
          ...(prev[albumId] || {}),
          quota: val,
        },
      }));
      setEditingQuotaId(null);
      if (onSuccessToast) onSuccessToast(`Đã cập nhật chỉ tiêu cho album!`);
    } catch (err) {
      alert(err.message || 'Lỗi khi cập nhật chỉ tiêu');
    }
  };

  const startPackageReview = () => {
    if (!isPackageReady || categories.length === 0) return;
    setIsReviewingPackage(true);
    bodyRef.current?.scrollTo(0, 0);
  };

  // Export Categorized Package
  const handleExportPackage = async () => {
    if (!isReviewingPackage || !isPackageReady || categories.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportReport(null);
    try {
      const res = await exportCategorizedPackage(packageFolderName.trim(), categories);
      setExportReport(res);
      if (onSuccessToast) {
        onSuccessToast(`Đã xuất thành công gói ảnh vào thư mục "${res.targetDir}"!`);
      }
      if (onRefreshTree) onRefreshTree();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Lỗi khi xuất gói ảnh cưới');
    } finally {
      setIsExporting(false);
    }
  };

  // Custom copy to clipboard
  const handleCopyClipboard = () => {
    navigator.clipboard.writeText(exportedText);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
    if (onSuccessToast) onSuccessToast('Đã sao chép danh sách vào bộ nhớ tạm!');
  };

  // Custom download .TXT
  const handleDownloadTxt = () => {
    const blob = new Blob([exportedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Danh_Sach_Anh_Gui_Studio_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    if (onSuccessToast) onSuccessToast('Đã tải file danh sách .txt!');
  };

  // Custom physical file copy
  const handleCopyPhysicalFiles = async () => {
    if (targetPhotos.length === 0) return;
    setIsExporting(true);
    try {
      const files = targetPhotos.map(p => p.relPath);
      const res = await copyPhotosToExport(files, exportFolderName.trim() || 'Gui_Studio_In');
      if (onSuccessToast) {
        onSuccessToast(`Đã gom ${res.copiedCount} ảnh vào thư mục "${res.targetDir}" thành công!`);
      }
      if (onRefreshTree) onRefreshTree();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Lỗi khi gom file ảnh');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DialogShell title="Xuất ảnh cho studio" description="Kiểm tra chỉ tiêu từng hạng mục, rồi xuất bản sao đã phân loại kèm ghi chú retouch." icon={Package} onClose={onClose} size="max-w-3xl" bodyClassName="flex min-h-0 flex-1 flex-col">

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-950/40 shrink-0">
          <button
            onClick={() => setActiveTab('package')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'package'
                ? 'border-rose-500 text-rose-300 bg-rose-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-rose-400" />
            <span>Gói hoàn chỉnh theo hạng mục (khuyên dùng)</span>
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'custom'
                ? 'border-rose-500 text-rose-300 bg-rose-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4 text-blue-400" />
            <span>Xuất danh sách tên ảnh (.txt hoặc sao chép)</span>
          </button>
        </div>

        {/* Content Body */}
        <div ref={bodyRef} className="p-6 flex-1 overflow-y-auto space-y-6">
          {!isPackageReady && (activeTab === 'package' || scope !== 'selected') && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300" role="status">
              {isLoadingPackagePhotos ? 'Đang tải tất cả ảnh trong dự án…' : packagePhotosError}
              {!isLoadingPackagePhotos && onRetryPackagePhotos && (
                <button type="button" onClick={onRetryPackagePhotos} className="ml-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700">
                  Thử lại
                </button>
              )}
            </div>
          )}
          {activeTab === 'package' && isPackageReady && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {isReviewingPackage ? '2. Duyệt ảnh theo hạng mục' : '1. Kiểm tra chỉ tiêu từng hạng mục'}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {isReviewingPackage
                    ? `Gói sẽ tạo ${categories.length} thư mục ảnh. Ảnh thuộc nhiều hạng mục xuất hiện trong từng thư mục tương ứng.`
                    : 'Bấm biểu tượng bút chì để chỉnh chỉ tiêu. Đặt 0 nếu hạng mục không giới hạn số ảnh.'}
                </p>
                {!isReviewingPackage && setupGroups.some(item => item.albumId) && (
                  <p className="mt-1 text-xs text-slate-400">
                    Bật “Xuất riêng” ở từng album tự tạo để thêm thư mục của album đó vào gói.
                  </p>
                )}

                <div className={`grid grid-cols-1 gap-3 mt-3 ${isReviewingPackage ? '' : 'sm:grid-cols-2'}`}>
                  {visibleGroups.map((item) => {
                    const count = item.photos.length;
                    const diff = count - item.quota;
                    const isEditing = editingQuotaId === item.id;

                    let statusBadge;
                    if (item.quota === 0) {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300">
                          Không giới hạn
                        </span>
                      );
                    } else if (item.shortfall > 0) {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800">
                          Thiếu {item.shortfall} ảnh
                        </span>
                      );
                    } else if (item.quota !== null && diff === 0) {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                          ✓ Đủ chỉ tiêu
                        </span>
                      );
                    } else if (item.quota !== null && diff > 0) {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/80 text-rose-300 border border-rose-800">
                          + Vượt {diff} ảnh
                        </span>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                              <span>{item.icon}</span>
                              <span className="truncate">{item.title}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                              {isReviewingPackage && count === 0 ? (
                                <span>Chưa có ảnh nên gói sẽ không tạo thư mục này.</span>
                              ) : (
                                <code className="text-slate-300 font-mono break-all">{item.folderName}/</code>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-mono font-bold text-white">
                                {count}
                              </span>
                              {item.quota !== null && (
                                <>
                                  <span className="text-slate-500 font-mono">/</span>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min="0"
                                        aria-label={`Chỉ tiêu ${item.title}`}
                                        autoFocus
                                        value={editingQuotaVal}
                                        onChange={(e) => setEditingQuotaVal(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleSaveQuota(item);
                                          if (e.key === 'Escape') { e.preventDefault(); setEditingQuotaId(null); }
                                        }}
                                        className="w-12 px-1 py-0.5 bg-slate-900 border border-amber-500 rounded text-xs font-mono text-center text-white focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleSaveQuota(item)}
                                        aria-label={`Lưu chỉ tiêu ${item.title}`}
                                        className="p-1 bg-amber-700 text-paper rounded hover:bg-amber-500 text-[10px]"
                                      >
                                        ✓
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs font-mono text-slate-400">{item.quota === 0 ? '∞' : item.quota}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingQuotaId(item.id);
                                          setEditingQuotaVal(String(item.quota));
                                        }}
                                        className="p-1 text-slate-500 hover:text-amber-400 rounded transition"
                                        title="Chỉnh chỉ tiêu số lượng"
                                        aria-label={`Chỉnh chỉ tiêu ${item.title}`}
                                      >
                                        <Edit3 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                              {item.quota === null && <span className="text-xs text-slate-400">ảnh</span>}
                            </div>
                            {statusBadge}
                          </div>
                        </div>
                        {!isReviewingPackage && item.albumId && (
                          <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              aria-label={`Xuất riêng album ${item.title}`}
                              checked={item.included}
                              disabled={isExporting}
                              onChange={event => {
                                const { checked } = event.target;
                                setIncludedCustomAlbumIds(previous => checked
                                  ? [...previous, item.albumId]
                                  : previous.filter(id => id !== item.albumId));
                              }}
                              className="rounded bg-slate-800 border-slate-700 text-rose-600 focus:ring-rose-500"
                            />
                            Xuất riêng
                          </label>
                        )}
                        {isReviewingPackage && count > 0 && (
                          <div className="mt-3 border-t border-slate-800 pt-2">
                            <PackageThumbnails
                              photos={item.photos}
                              description={`của ${item.title}`}
                              defaultExpanded={item.id === categories[0]?.id}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {isReviewingPackage && (
                <div className={`rounded-xl border p-3.5 space-y-2 ${unassignedPicks.length > 0 ? 'bg-amber-950/30 border-amber-800/70' : 'bg-slate-950/70 border-slate-800'}`}>
                  <h4 className="text-xs font-semibold text-white">Ảnh giữ lại chưa gán album</h4>
                  {unassignedPicks.length > 0 ? (
                    <>
                      <p className="text-xs text-amber-200">
                        {unassignedPicks.length} ảnh chưa gán album vẫn được sao chép vào <code className="break-all">05_Tat_Ca_Anh_Giu_Lai/</code>.
                      </p>
                      <PackageThumbnails photos={unassignedPicks} description="chưa gán album" />
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Không có ảnh giữ lại nào chưa gán album.</p>
                  )}
                </div>
              )}

              {!isReviewingPackage ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">
                    {categories.length > 0
                      ? 'Xem ảnh sẽ có trong từng thư mục trước khi xuất cho studio.'
                      : 'Chưa có ảnh để xuất. Hãy gán ảnh vào album có trong gói, bật “Xuất riêng” cho album tự tạo có ảnh hoặc đánh dấu giữ lại.'}
                  </p>
                  <button
                    type="button"
                    onClick={startPackageReview}
                    disabled={categories.length === 0 || isExporting}
                    className="py-2.5 px-5 bg-rose-600 hover:bg-rose-500 text-paper rounded-xl text-xs font-semibold transition disabled:opacity-50"
                  >
                    Duyệt ảnh trước khi xuất
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-gradient-to-r from-rose-950/40 via-purple-950/30 to-slate-900 border border-rose-800/50 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-rose-300 text-xs font-bold uppercase tracking-wider">
                    <Sparkles className="w-4 h-4 text-rose-400" />
                    <span>3. Xác nhận xuất gói ảnh</span>
                  </div>
                  {groups.some(item => item.shortfall > 0) && (
                    <p className="text-xs text-amber-200">Một số hạng mục còn thiếu ảnh. Bạn vẫn có thể xuất gói hiện tại.</p>
                  )}
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Hệ thống sẽ sao chép ảnh vào các thư mục đã duyệt và tạo 2 file văn bản:
                    <br />
                    📄 <code className="text-emerald-400 font-mono">Danh_Sach_Va_Ghi_Chu_Retouch.txt</code> (ghi chú + các điểm khoanh chỉnh sửa)
                    <br />
                    📄 <code className="text-amber-400 font-mono">Bao_Cao_Xuat.txt</code> (báo cáo số lượng và danh sách ảnh lỗi nếu có)
                  </p>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 flex-1">
                      <span className="text-xs text-slate-500 font-mono">📁 /</span>
                      <input
                        type="text"
                        aria-label="Tên thư mục xuất gói ảnh"
                        value={packageFolderName}
                        onChange={(e) => setPackageFolderName(e.target.value)}
                        placeholder="Xuat_Anh_Cuoi_2026-11-03"
                        className="bg-transparent text-xs text-white focus:outline-none flex-1 font-mono font-medium"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleExportPackage}
                      disabled={isExporting || categories.length === 0}
                      className="py-2.5 px-5 bg-rose-600 hover:bg-rose-500 text-paper rounded-xl text-xs font-semibold shadow-lg shadow-rose-950 transition flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span>{isExporting ? 'Đang xuất gói ảnh…' : 'Xác nhận xuất cho studio'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => {
                      setIsReviewingPackage(false);
                      bodyRef.current?.scrollTo(0, 0);
                    }}
                    className="text-xs font-medium text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    Quay lại kiểm tra chỉ tiêu
                  </button>
                </div>
              )}

              {/* Export Report / Failure Inspection */}
              {exportReport && (
                <div className={`p-4 rounded-xl border animate-in fade-in duration-200 ${
                  exportReport.totalFailed > 0
                    ? 'bg-rose-950/60 border-rose-700/80 text-rose-200'
                    : 'bg-emerald-950/60 border-emerald-700/80 text-emerald-200'
                }`}>
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {exportReport.totalFailed > 0 ? (
                      <>
                        <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                        <span>Xuất hoàn tất nhưng có {exportReport.totalFailed} ảnh thất bại!</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        <span>Xuất thành công 100% ({exportReport.totalCopied} ảnh) vào thư mục "{exportReport.targetDir}"!</span>
                      </>
                    )}
                  </div>

                  <div className="text-xs mt-2 space-y-1">
                    <div className="text-slate-300">
                      Tổng số ảnh đã sao chép: <strong>{exportReport.totalCopied}</strong> ảnh.
                    </div>
                    {exportReport.categoriesSummary?.map((cat, idx) => (
                      <div key={idx} className="text-slate-300">
                        • {cat.category}: {cat.copied}/{cat.total} ảnh
                      </div>
                    ))}
                  </div>

                  {exportReport.failedFiles?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-rose-800/60">
                      <div className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-1.5">
                        Danh sách file ảnh lỗi cần kiểm tra:
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {exportReport.failedFiles.map((f, idx) => (
                          <div key={idx} className="text-xs font-mono bg-rose-900/40 p-1.5 rounded border border-rose-800 flex items-center justify-between gap-2">
                            <span className="truncate">[{f.category}] {f.file}</span>
                            <span className="text-rose-400 font-sans text-[11px] shrink-0 font-bold">{f.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {activeTab === 'custom' && (
            <>
              {/* 1. Chọn nguồn ảnh */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  1. Chọn nhóm ảnh cần xuất:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setScope('favorites')}
                    className={`p-2.5 rounded-xl border text-xs font-medium text-left transition ${
                      scope === 'favorites'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-sm text-white">❤️ Yêu thích</div>
                    <div className="text-[11px] opacity-75">{isPackageReady ? `${favoritePhotos.length} ảnh` : '—'}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('selected')}
                    disabled={selectedPhotos.length === 0}
                    className={`p-2.5 rounded-xl border text-xs font-medium text-left transition ${
                      scope === 'selected'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white disabled:opacity-40'
                    }`}
                  >
                    <div className="font-bold text-sm text-white">☑️ Đang chọn</div>
                    <div className="text-[11px] opacity-75">{selectedPhotos.length} ảnh</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('viewed')}
                    className={`p-2.5 rounded-xl border text-xs font-medium text-left transition ${
                      scope === 'viewed'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-sm text-white">👁️ Đã xem</div>
                    <div className="text-[11px] opacity-75">{isPackageReady ? `${viewedPhotos.length} ảnh` : '—'}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`p-2.5 rounded-xl border text-xs font-medium text-left transition ${
                      scope === 'all'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-sm text-white">📁 Toàn bộ dự án</div>
                    <div className="text-[11px] opacity-75">{isPackageReady ? `${allPhotos.length} ảnh` : '—'}</div>
                  </button>
                </div>
              </div>

              {/* 2. Danh sách tên file */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    2. Danh sách tên file ({targetPhotos.length} ảnh):
                  </label>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeNotes}
                        onChange={(e) => setIncludeNotes(e.target.checked)}
                        className="rounded bg-slate-800 border-slate-700 text-rose-600 focus:ring-0"
                      />
                      <span>Kèm ghi chú</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeFolders}
                        onChange={(e) => setIncludeFolders(e.target.checked)}
                        className="rounded bg-slate-800 border-slate-700 text-rose-600 focus:ring-0"
                      />
                      <span>Kèm tên thư mục</span>
                    </label>
                  </div>
                </div>

                <textarea
                  readOnly
                  value={exportedText}
                  rows={6}
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 focus:outline-none"
                  placeholder="Chưa có ảnh nào được chọn..."
                />

                <div className="flex gap-2.5 mt-2">
                  <button
                    type="button"
                    onClick={handleCopyClipboard}
                    disabled={targetPhotos.length === 0}
                    className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-40"
                  >
                    {copiedText ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedText ? 'Đã sao chép!' : 'Sao chép vào Clipboard (Dán Zalo/Mail)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadTxt}
                    disabled={targetPhotos.length === 0}
                    className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-40"
                    title="Tải file text về máy"
                  >
                    <Download className="w-4 h-4 text-blue-400" />
                    <span>Tải .TXT</span>
                  </button>
                </div>
              </div>

              {/* 3. Gom ảnh đơn lẻ */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-rose-300 text-xs font-bold uppercase tracking-wider">
                  <FolderPlus className="w-4 h-4 text-rose-400" />
                  <span>3. Gom ảnh nhóm này vào một thư mục riêng:</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 flex-1">
                    <span className="text-xs text-slate-500 font-mono">📁 /</span>
                    <input
                      type="text"
                      value={exportFolderName}
                      onChange={(e) => setExportFolderName(e.target.value)}
                      placeholder="Gui_Studio_In"
                      className="bg-transparent text-xs text-white focus:outline-none flex-1 font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyPhysicalFiles}
                    disabled={isExporting || targetPhotos.length === 0}
                    className="py-2 px-4 bg-rose-600 hover:bg-rose-500 text-paper rounded-xl text-xs font-semibold shadow-md shadow-rose-950 transition flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    <FolderPlus className="w-4 h-4" />
                    <span>{isExporting ? 'Đang gom ảnh...' : `Copy ${targetPhotos.length} ảnh vào thư mục này`}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
          >
            Đóng
          </button>
        </div>
    </DialogShell>
  );
}
