import React, { useState, useEffect } from 'react';
import { 
  X, Check, Target, Plus, Minus, Sparkles, 
  Trash2, FolderPlus, HelpCircle 
} from 'lucide-react';
import { DialogShell } from './DialogShell.jsx';

const DEFAULT_DESCRIPTIONS = {
  gate: 'Ảnh phóng lớn 60x90cm đón khách ở sảnh cưới',
  album: 'Bộ ảnh in sách Photobook cưới chính (30 - 45 ảnh)',
  table: 'Các khung ảnh nhỏ trang trí bàn Gallery đón tiếp khách',
  slide: 'Ảnh trình chiếu màn hình LED nhà hàng trong lúc làm lễ',
};

const ALBUM_ICONS = {
  gate: '🚪',
  album: '📖',
  table: '🖼️',
  slide: '📽️',
};

export function QuotaModal({
  isOpen,
  onClose,
  virtualAlbums = {},
  onUpdateQuota,
  onCreateAlbum,
  onDeleteAlbum,
  onSuccessToast,
}) {
  const [quotas, setQuotas] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newAlbumQuota, setNewAlbumQuota] = useState('10');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const initial = {};
      Object.entries(virtualAlbums).forEach(([id, alb]) => {
        initial[id] = alb.quota !== undefined ? alb.quota : 0;
      });
      setQuotas(initial);
      setShowAddForm(false);
      setNewAlbumName('');
      setNewAlbumQuota('10');
    }
  }, [isOpen, virtualAlbums]);

  if (!isOpen) return null;

  const handleStep = (albumId, delta) => {
    setQuotas(prev => {
      const current = prev[albumId] !== undefined ? prev[albumId] : 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [albumId]: next };
    });
  };

  const handleInputChange = (albumId, valStr) => {
    const val = parseInt(valStr, 10);
    setQuotas(prev => ({
      ...prev,
      [albumId]: isNaN(val) ? 0 : Math.max(0, val),
    }));
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      for (const [id, quota] of Object.entries(quotas)) {
        if (virtualAlbums[id] && virtualAlbums[id].quota !== quota) {
          await onUpdateQuota(id, quota);
        }
      }
      if (onSuccessToast) onSuccessToast('Đã lưu chỉ tiêu số lượng thành công!');
      onClose();
    } catch (err) {
      alert(err.message || 'Lỗi khi lưu chỉ tiêu');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNewAlbum = async (e) => {
    e.preventDefault();
    if (!newAlbumName.trim()) return;
    const safeId = newAlbumName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const quotaVal = parseInt(newAlbumQuota, 10) || 0;

    try {
      if (onCreateAlbum) {
        await onCreateAlbum(safeId, newAlbumName.trim(), quotaVal);
        setQuotas(prev => ({ ...prev, [safeId]: quotaVal }));
        setShowAddForm(false);
        setNewAlbumName('');
        if (onSuccessToast) onSuccessToast(`Đã tạo album ảo "${newAlbumName}" thành công!`);
      }
    } catch (err) {
      alert(err.message || 'Lỗi khi tạo album mới');
    }
  };

  return (
    <DialogShell title="Chỉ tiêu số lượng ảnh" description="Số ảnh cần chọn cho từng mục theo hợp đồng với studio." icon={Target} onClose={onClose} size="max-w-xl" bodyClassName="flex min-h-0 flex-1 flex-col">

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <div className="space-y-3">
            {Object.values(virtualAlbums).map((album) => {
              const currentQuota = quotas[album.id] !== undefined ? quotas[album.id] : album.quota;
              const count = album.photos?.length || 0;
              const icon = ALBUM_ICONS[album.id] || '🏷️';
              const description = DEFAULT_DESCRIPTIONS[album.id] || `Thư mục phân loại ảnh: ${album.name}`;
              const isDefault = ['gate', 'album', 'table', 'slide'].includes(album.id);

              return (
                <div 
                  key={album.id}
                  className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between gap-4 hover:border-slate-700 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{icon}</span>
                      <span className="font-bold text-xs text-white truncate">{album.name}</span>
                      <span className="px-2 py-0.2 rounded-full text-[10px] font-mono bg-slate-900 border border-slate-800 text-slate-400">
                        Đang chọn: <strong className="text-rose-400">{count}</strong>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 truncate">
                      {description}
                    </p>
                  </div>

                  {/* Stepper Input */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleStep(album.id, -1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition border border-slate-700 active:scale-95"
                      title="Giảm 1 ảnh"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={currentQuota}
                        onChange={(e) => handleInputChange(album.id, e.target.value)}
                        className="w-14 h-7 text-center bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStep(album.id, 1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition border border-slate-700 active:scale-95"
                      title="Tăng 1 ảnh"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    <span className="text-xs text-slate-400 font-medium ml-1">ảnh</span>

                    {!isDefault && onDeleteAlbum && (
                      <button
                        type="button"
                        onClick={() => onDeleteAlbum(album.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-950/40 ml-1 transition"
                        title="Xoá album ảo này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add custom album section */}
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="w-full py-2.5 px-3 border border-dashed border-slate-700/80 hover:border-slate-500 rounded-xl text-xs text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 transition bg-slate-950/30"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Thêm mục phân loại ảnh cưới tuỳ chỉnh...</span>
            </button>
          ) : (
            <form onSubmit={handleCreateNewAlbum} className="p-3.5 bg-slate-950 border border-slate-700 rounded-xl space-y-3">
              <div className="text-xs font-semibold text-slate-300">Tạo mục phân loại mới:</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  placeholder="Tên mục (VD: Bìa photobook, Cảm ơn...)"
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500"
                />
                <input
                  type="number"
                  min="0"
                  placeholder="Chỉ tiêu"
                  value={newAlbumQuota}
                  onChange={(e) => setNewAlbumQuota(e.target.value)}
                  className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-center text-white focus:outline-none focus:border-rose-500"
                />
                <button
                  type="submit"
                  disabled={!newAlbumName.trim()}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-paper rounded-lg text-xs font-semibold transition disabled:opacity-40"
                >
                  Tạo
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-2 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Huỷ
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-between items-center shrink-0">
          <span className="text-[11px] text-slate-500">
            💡 Chỉ tiêu sẽ áp dụng ngay vào thanh tiến độ và bảng xuất ảnh Studio
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={isSaving}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-paper rounded-xl text-xs font-semibold shadow-lg shadow-rose-950 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Đang lưu...' : 'Lưu chỉ tiêu'}</span>
            </button>
          </div>
        </div>
    </DialogShell>
  );
}
