import React, { useState, useEffect } from 'react';
import { 
  FolderPlus, Edit2, Trash2, FolderInput, Settings, 
  FileText, X, Check, AlertTriangle, Copy, Folder, 
  ArrowUp, Compass, HardDrive, Info, ArrowRight, Plus
} from 'lucide-react';
import { DialogShell } from './DialogShell.jsx';
import { browseFilesystem, pickFolderNative, photoImageUrl } from '../api.js';
import { resolvePhotoRange, sanitizeFolderName } from '../photoRange.js';

// 1. Create Subfolder Modal
export function CreateFolderModal({ isOpen, onClose, onSubmit, parentPath, parentName }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Vui lòng nhập tên thư mục');
      return;
    }
    onSubmit(parentPath, name.trim());
  };

  return (
    <DialogShell title="Tạo thư mục con" icon={FolderPlus} onClose={onClose} size="max-w-md" bodyClassName="flex min-h-0 flex-1 flex-col">

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <div className="text-xs text-slate-400 mb-1">Thư mục cha:</div>
            <div className="text-sm font-medium text-slate-200 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/60 truncate">
              <Folder className="mr-1.5 inline h-4 w-4 text-stone-400" aria-hidden="true" />{parentName || 'Thư mục gốc'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Tên thư mục con mới <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="VD: Anh_Cong_60x90, Album_Chinh, Gallery..."
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 text-sm"
            />
            {error && <p className="text-xs text-rose-400 mt-1.5">{error}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              Huỷ
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium bg-rose-600 hover:bg-rose-500 text-paper rounded-xl shadow-lg shadow-rose-900/40 transition flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Tạo thư mục
            </button>
          </div>
        </form>
    </DialogShell>
  );
}

// 2. Rename Folder Modal
export function RenameFolderModal({ isOpen, onClose, onSubmit, folderPath, currentName }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(currentName || '');
      setError('');
    }
  }, [isOpen, currentName]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Vui lòng nhập tên mới');
      return;
    }
    onSubmit(folderPath, name.trim());
  };

  return (
    <DialogShell title="Đổi tên thư mục" icon={Edit2} onClose={onClose} size="max-w-md" bodyClassName="flex min-h-0 flex-1 flex-col">

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Tên mới cho thư mục
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-sm"
            />
            {error && <p className="text-xs text-rose-400 mt-1.5">{error}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              Huỷ
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-paper rounded-xl shadow-lg shadow-blue-900/40 transition flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Lưu thay đổi
            </button>
          </div>
        </form>
    </DialogShell>
  );
}

// 3. Delete Folder Modal
export function DeleteFolderModal({ isOpen, onClose, onConfirm, folderPath, name }) {
  if (!isOpen) return null;

  return (
    <DialogShell title="Xoá thư mục" icon={Trash2} onClose={onClose} size="max-w-md" bodyClassName="flex min-h-0 flex-1 flex-col">

        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-300">
            Bạn có chắc chắn muốn xoá thư mục <strong className="text-white">"{name}"</strong>?
          </p>
          <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-xs text-rose-300 leading-relaxed">
            ⚠️ Lưu ý: Thao tác này sẽ xoá vĩnh viễn thư mục này cùng toàn bộ thư mục con và các file ảnh bên trong trên ổ cứng máy tính của bạn!
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              Huỷ bỏ
            </button>
            <button
              type="button"
              onClick={() => onConfirm(folderPath)}
              className="px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-paper rounded-xl shadow-lg shadow-red-950/60 transition flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Xoá vĩnh viễn
            </button>
          </div>
        </div>
    </DialogShell>
  );
}

// 4. Move Photos Modal
export function MoveModal({ isOpen, onClose, onConfirm, files, folders, isMoving = false }) {
  const [selectedTarget, setSelectedTarget] = useState('');

  useEffect(() => {
    if (isOpen && folders.length > 0) {
      setSelectedTarget(folders[0].relPath);
    }
  }, [isOpen, folders]);

  if (!isOpen) return null;

  return (
    <DialogShell title={`Chuyển ${files.length} ảnh`} description="Chọn thư mục đích." icon={FolderInput} onClose={onClose} size="max-w-lg" bodyClassName="flex min-h-0 flex-1 flex-col">

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-400">
            Chọn thư mục đích bạn muốn chuyển <span className="text-white font-medium">{files.length} ảnh</span> vào:
          </p>

          <div className="max-h-64 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded-xl p-2 bg-slate-950">
            {folders.map((f) => (
              <label
                key={f.relPath}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition text-sm ${
                  selectedTarget === f.relPath
                    ? 'bg-rose-600 text-paper font-medium shadow-md'
                    : 'text-slate-300 hover:bg-slate-800/70'
                }`}
                style={{ paddingLeft: `${Math.max(12, f.depth * 20)}px` }}
              >
                <div className="flex items-center gap-2 truncate">
                  <Folder className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="truncate">{f.name}</span>
                </div>
                <input
                  type="radio"
                  name="targetFolder"
                  value={f.relPath}
                  checked={selectedTarget === f.relPath}
                  onChange={() => setSelectedTarget(f.relPath)}
                  className="sr-only"
                />
                <span className="text-xs opacity-75">{f.photoCount} ảnh</span>
              </label>
            ))}
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-1.5 bg-slate-800/40 p-2.5 rounded-lg">
            <Info className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
            <span>Trạng thái <strong>Đã xem</strong> và <strong>Ghi chú</strong> của ảnh sẽ được giữ nguyên sau khi chuyển!</span>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={() => onConfirm(files, selectedTarget)}
              disabled={isMoving}
              className="px-5 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-paper rounded-xl shadow-lg shadow-emerald-950/60 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {isMoving ? 'Đang chuyển ảnh…' : 'Xác nhận di chuyển'}
            </button>
          </div>
        </div>
    </DialogShell>
  );
}

// 5. Settings Modal (Choose Local Folder)
export function SettingsModal({ isOpen, onClose, currentPath, onSave }) {
  const [pathInput, setPathInput] = useState('');
  const [error, setError] = useState('');
  const [browserData, setBrowserData] = useState(null);
  const [isLoadingDirs, setIsLoadingDirs] = useState(false);
  const [isPickingNative, setIsPickingNative] = useState(false);

  const loadBrowser = async (dir) => {
    setIsLoadingDirs(true);
    try {
      const data = await browseFilesystem(dir);
      setBrowserData(data);
      if (data && data.currentDir) {
        setPathInput(data.currentDir);
      }
    } catch (err) {
      console.error('Error browsing filesystem:', err);
    } finally {
      setIsLoadingDirs(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setPathInput(currentPath || '');
      setError('');
      loadBrowser(currentPath || '');
    }
  }, [isOpen, currentPath]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!pathInput.trim()) {
      setError('Vui lòng chọn hoặc nhập đường dẫn thư mục');
      return;
    }
    onSave(pathInput.trim());
  };

  const handleNativePick = async () => {
    setIsPickingNative(true);
    try {
      const res = await pickFolderNative();
      if (res && res.success && res.path) {
        setPathInput(res.path);
        loadBrowser(res.path);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsPickingNative(false);
    }
  };

  return (
    <DialogShell title="Chọn thư mục ảnh" description="Thư mục trên máy tính chứa bộ ảnh cưới." icon={HardDrive} onClose={onClose} size="max-w-2xl" bodyClassName="flex min-h-0 flex-1 flex-col">

        <form onSubmit={handleSubmit} className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Native Picker Button */}
          <div className="flex items-center justify-between bg-purple-950/30 border border-purple-800/50 p-3.5 rounded-xl">
            <div className="text-xs text-purple-200">
              <span className="font-semibold block text-white text-sm mb-0.5">Mở cửa sổ Finder</span>
              Bấm để mở hộp thoại chọn thư mục chuẩn của máy tính Mac
            </div>
            <button
              type="button"
              onClick={handleNativePick}
              disabled={isPickingNative}
              className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-paper text-xs font-semibold rounded-xl shadow-md transition shrink-0 flex items-center gap-1.5"
            >
              <Compass className="w-4 h-4" />
              <span>{isPickingNative ? 'Đang mở Finder...' : 'Chọn từ Finder'}</span>
            </button>
          </div>

          {/* Quick Locations */}
          {browserData?.quickLocations && (
            <div>
              <div className="text-xs font-medium text-slate-400 mb-2">Vị trí thường dùng:</div>
              <div className="flex flex-wrap gap-2">
                {browserData.quickLocations.map((loc) => (
                  <button
                    key={loc.path}
                    type="button"
                    onClick={() => loadBrowser(loc.path)}
                    className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 hover:text-white rounded-lg border border-slate-700 text-slate-300 transition flex items-center gap-1"
                  >
                    <span>{loc.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current Browser Viewport */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>Duyệt thư mục máy tính:</span>
              {browserData?.parentDir && (
                <button
                  type="button"
                  onClick={() => loadBrowser(browserData.parentDir)}
                  className="text-purple-400 hover:text-purple-300 flex items-center gap-1 hover:underline"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>Lên thư mục cha</span>
                </button>
              )}
            </div>

            <div className="border border-slate-800 rounded-xl bg-slate-950 p-2 max-h-48 overflow-y-auto space-y-1">
              {isLoadingDirs ? (
                <div className="p-4 text-center text-xs text-slate-500">Đang nạp danh sách thư mục...</div>
              ) : browserData?.folders?.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Không có thư mục con nào ở đây</div>
              ) : (
                browserData?.folders?.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => loadBrowser(f.path)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left rounded-lg text-slate-300 hover:bg-slate-800/80 hover:text-white transition group"
                  >
                    <Folder className="w-4 h-4 text-purple-400 shrink-0 group-hover:scale-110 transition" />
                    <span className="truncate flex-1 font-medium">{f.name}</span>
                    <span className="text-[10px] text-slate-500 group-hover:text-purple-300">Nhấp để mở ➔</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Path Input Preview */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Đường dẫn thư mục được chọn:
            </label>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); setError(''); }}
              placeholder="/Users/.../Pictures/AnhCuoi"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 text-xs font-mono"
            />
            {error && <p className="text-xs text-rose-400 mt-1.5">{error}</p>}
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              Đóng
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-paper rounded-xl shadow-lg shadow-purple-950/60 transition flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Nạp Thư Mục Này
            </button>
          </div>
        </form>
    </DialogShell>
  );
}

// 6. State Viewer Modal (View viewed_state.json directly)
export function StateViewModal({ isOpen, onClose, stateData, onRefresh }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const jsonString = JSON.stringify(stateData || {}, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const viewedCount = Object.keys(stateData?.viewed || {}).length;
  const favCount = Object.keys(stateData?.favorites || {}).length;

  return (
    <DialogShell title="Dữ liệu trạng thái" description="Tệp viewed_state.json lưu trên máy." icon={FileText} onClose={onClose} size="max-w-2xl" bodyClassName="flex min-h-0 flex-1 flex-col">

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div>
              Vị trí lưu trên máy: <span className="text-slate-200 font-mono">./data/viewed_state.json</span>
            </div>
            <div className="flex gap-4">
              <span>Đã xem: <strong className="text-emerald-400">{viewedCount}</strong></span>
              <span>Yêu thích: <strong className="text-rose-400">{favCount}</strong></span>
            </div>
          </div>

          <div className="relative">
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 max-h-96 overflow-y-auto whitespace-pre-wrap">
              {jsonString}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-3 right-3 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 flex items-center gap-1 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Đã sao chép' : 'Sao chép JSON'}</span>
            </button>
          </div>
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <button
            onClick={onRefresh}
            className="text-xs text-slate-400 hover:text-white underline"
          >
            🔄 Tải lại dữ liệu mới nhất
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
          >
            Đóng
          </button>
        </div>
    </DialogShell>
  );
}


// Group photos "from photo … to photo …": one or more ranges into one folder.
let rangeRowSeq = 0;
const newRangeRow = () => ({ id: ++rangeRowSeq, from: '', to: '' });
const rangeThumbUrl = photo => photoImageUrl('thumbnail', photo);
const NEW_FOLDER_OPTION = '::new-folder::'; // ':' can't appear in a real folder name

function RangeThumb({ photo, index, label }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <img src={rangeThumbUrl(photo)} alt="" loading="lazy"
        className="h-12 w-16 shrink-0 rounded-md border border-slate-700 bg-slate-900 object-cover" />
      <div className="min-w-0 text-[11px] leading-tight">
        <div className="text-slate-500">{label} · #{index + 1}</div>
        <div className="truncate font-medium text-slate-200" title={photo.name}>{photo.name}</div>
      </div>
    </div>
  );
}

export function RangeGroupModal({ isOpen, onClose, onConfirm, onSelect, photos, folders, currentFolder, isMoving = false }) {
  const [mode, setMode] = useState('name');
  const [rows, setRows] = useState(() => [newRangeRow()]);
  const [target, setTarget] = useState('new');
  const [newName, setNewName] = useState('');
  const [existing, setExisting] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setRows([newRangeRow()]);
    setNewName('');
    setError('');
    setTarget('new');
    setExisting(folders[0]?.relPath ?? '');
  }, [isOpen]);

  if (!isOpen) return null;

  const resolved = rows.map(row => {
    if (!row.from.trim() && !row.to.trim()) return { row, empty: true };
    if (!row.from.trim()) return { row, error: 'Nhập ảnh bắt đầu ở ô “Từ ảnh”.' };
    const result = resolvePhotoRange(photos, row.from, row.to, mode);
    return result.error ? { row, error: result.error } : { row, result };
  });

  const picked = new Set();
  for (const item of resolved) {
    if (!item.result) continue;
    for (let i = item.result.startIndex; i <= item.result.endIndex; i++) picked.add(i);
  }
  const selected = [...picked].sort((a, b) => a - b).map(i => photos[i]);
  const count = selected.length;
  const hasErrors = resolved.some(item => item.error);
  const childPath = name => (currentFolder ? `${currentFolder}/${name}` : name);

  const updateRow = (id, field, value) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, [field]: value } : row)));
    setError('');
  };
  const addRow = () => setRows(prev => [...prev, newRangeRow()]);
  const removeRow = id => setRows(prev => (prev.length > 1 ? prev.filter(row => row.id !== id) : prev));

  const handleMove = (e) => {
    e.preventDefault();
    if (!count) return setError('Nhập ảnh bắt đầu và ảnh kết thúc trước.');
    if (hasErrors) return setError('Sửa các lỗi ở trên trước khi gom.');
    const files = selected.map(p => p.relPath);
    if (target === 'new') {
      const name = sanitizeFolderName(newName);
      if (!name) return setError('Vui lòng nhập tên thư mục mới hợp lệ.');
      onConfirm([{ files, targetFolder: childPath(name), label: name }]);
    } else {
      const folder = folders.find(f => f.relPath === existing);
      onConfirm([{ files, targetFolder: existing, label: folder?.name ?? existing }]);
    }
  };

  const handleSelect = () => {
    if (!count) return setError('Nhập ảnh bắt đầu và ảnh kết thúc trước.');
    if (hasErrors) return setError('Sửa các lỗi ở trên trước khi chọn.');
    onSelect(selected.map(p => p.relPath));
  };

  const inputClass = 'w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 text-sm';
  const tabClass = active => `flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${active ? 'bg-rose-600 text-paper' : 'text-slate-300 hover:bg-slate-800'}`;
  const isName = mode === 'name';
  const switchMode = next => { setMode(next); setRows([newRangeRow()]); setError(''); };

  return (
    <DialogShell title="Gom ảnh từ … đến …" icon={FolderInput} onClose={onClose} size="max-w-xl" bodyClassName="flex min-h-0 flex-1 flex-col">

        <form onSubmit={handleMove} className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div role="group" aria-label="Nhập theo" className="flex gap-1 rounded-xl border border-slate-700 p-1">
            <button type="button" className={tabClass(isName)} aria-pressed={isName} onClick={() => switchMode('name')}>Theo tên ảnh</button>
            <button type="button" className={tabClass(!isName)} aria-pressed={!isName} onClick={() => switchMode('index')}>Theo STT</button>
          </div>

          {isName && (
            <datalist id="range-photo-names">
              {photos.map(p => <option key={p.relPath} value={p.name} />)}
            </datalist>
          )}

          <div className="space-y-3">
            {resolved.map((item, rowIndex) => {
              const { row, result } = item;
              return (
                <div key={row.id} className="space-y-2 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="mb-1 block text-[11px] font-medium text-slate-400">Từ ảnh</span>
                      <input autoFocus={rowIndex === rows.length - 1} value={row.from}
                        onChange={e => updateRow(row.id, 'from', e.target.value)}
                        list={isName ? 'range-photo-names' : undefined}
                        inputMode={isName ? undefined : 'numeric'}
                        placeholder={isName ? 'VD: DSC_6832 hoặc 6832' : 'VD: 1'}
                        aria-label={`Từ ảnh (khoảng ${rowIndex + 1})`} className={`${inputClass} font-mono`} />
                    </label>
                    <ArrowRight className="mb-2.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    <label className="min-w-0 flex-1">
                      <span className="mb-1 block text-[11px] font-medium text-slate-400">Đến ảnh</span>
                      <input value={row.to}
                        onChange={e => updateRow(row.id, 'to', e.target.value)}
                        list={isName ? 'range-photo-names' : undefined}
                        inputMode={isName ? undefined : 'numeric'}
                        placeholder={isName ? 'VD: DSC_6868 hoặc 6868' : 'VD: 20'}
                        aria-label={`Đến ảnh (khoảng ${rowIndex + 1})`} className={`${inputClass} font-mono`} />
                    </label>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => removeRow(row.id)} title="Xoá khoảng này" aria-label={`Xoá khoảng ${rowIndex + 1}`}
                        className="mb-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {result && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <RangeThumb photo={photos[result.startIndex]} index={result.startIndex} label="Đầu" />
                        {result.endIndex !== result.startIndex && (
                          <>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                            <RangeThumb photo={photos[result.endIndex]} index={result.endIndex} label="Cuối" />
                          </>
                        )}
                        <span className="shrink-0 rounded-md bg-rose-950/70 px-2 py-1 text-xs font-semibold text-rose-200">{result.photos.length} ảnh</span>
                      </div>
                      {result.snapped?.length > 0 && <div className="text-[11px] text-amber-300">Lấy ảnh gần nhất: {result.snapped.join('; ')}</div>}
                    </div>
                  )}
                  {item.error && <div className="text-[11px] text-rose-300">⚠ {item.error}</div>}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={addRow}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-slate-800 hover:text-rose-200">
              <Plus className="h-3.5 w-3.5" /> Thêm khoảng khác
            </button>
            <span aria-live="polite" className="text-xs text-slate-400">
              Tổng: <strong className="text-white">{count}</strong> ảnh
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            {isName
              ? 'Gõ tên ảnh hoặc chỉ con số (6832 → DSC_6832.JPG). Số không có ảnh sẽ lấy ảnh gần nhất. '
              : `STT là số # trên ảnh theo sắp xếp và bộ lọc hiện tại (1 – ${photos.length}). `}
            Để trống “Đến ảnh” nếu chỉ lấy 1 ảnh.
          </p>

          <div className="space-y-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">Gom vào thư mục</span>
              <select
                value={target === 'new' ? NEW_FOLDER_OPTION : existing}
                onChange={e => {
                  const value = e.target.value;
                  if (value === NEW_FOLDER_OPTION) setTarget('new');
                  else { setTarget('existing'); setExisting(value); }
                  setError('');
                }}
                aria-label="Gom vào thư mục" className={inputClass}>
                <option value={NEW_FOLDER_OPTION}>➕ Tạo thư mục mới trong “{currentFolder || 'Thư mục gốc'}”…</option>
                {folders.length > 0 && (
                  <optgroup label="Thư mục có sẵn">
                    {folders.map(f => (
                      <option key={f.relPath} value={f.relPath}>{'\u00A0\u00A0\u00A0'.repeat(f.depth)}📁 {f.name} ({f.photoCount})</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {target === 'new' && (
              <input value={newName} onChange={e => { setNewName(e.target.value); setError(''); }}
                placeholder="Tên thư mục mới, VD: Anh_Cong, Le_Gia_Tien…" aria-label="Tên thư mục mới" className={inputClass} />
            )}
          </div>

          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition">Huỷ</button>
            <button type="button" onClick={handleSelect} disabled={!count || hasErrors}
              title="Chỉ chọn các ảnh này để gán album, đánh giá hoặc so sánh"
              className="px-4 py-2 text-sm font-medium text-rose-200 border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/80 rounded-xl transition disabled:opacity-50">
              Chọn {count || ''} ảnh
            </button>
            <button type="submit" disabled={isMoving || !count || hasErrors}
              className="px-5 py-2 text-sm font-medium bg-rose-600 hover:bg-rose-500 text-paper rounded-xl shadow-lg shadow-rose-900/40 transition flex items-center gap-1.5 disabled:opacity-50">
              <Check className="w-4 h-4" />
              {isMoving ? 'Đang gom…' : `Gom ${count || ''} ảnh`}
            </button>
          </div>
        </form>
    </DialogShell>
  );
}
