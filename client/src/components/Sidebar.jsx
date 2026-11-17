import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Edit2, Ellipsis, Folder, FolderOpen, FolderPlus, Grip, Tag, Target, Trash2 } from 'lucide-react';

const ALBUM_ICONS = { gate: '🚪', album: '📖', table: '🖼️', slide: '📽️' };

function FolderTreeItem({
  node,
  currentFolder,
  onSelectFolder,
  onCreateSubfolder,
  onRenameFolder,
  onDeleteFolder,
  onDropPhotos,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const isSelected = currentFolder === node.relPath;
  const isRoot = node.id === 'root';
  const hasChildren = node.children?.length > 0;
  const name = isRoot ? 'Tất cả ảnh' : node.name;

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const payload = JSON.parse(data);
        if (Array.isArray(payload.files)) {
          onDropPhotos(payload.files, node.relPath);
        }
      }
    } catch (err) {
      console.error('Error handling drop:', err);
    }
  };

  return (
    <div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`studio-folder-row ${isSelected ? 'studio-folder-active' : ''} ${isDragOver ? 'ring-2 ring-rose-500' : ''}`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Thu gọn' : 'Mở rộng'} ${name}`}
            className="studio-folder-icon"
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : <span className="w-6 shrink-0" />}

        <button
          type="button"
          onClick={() => onSelectFolder(node.relPath)}
          aria-current={isSelected ? 'location' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 text-left"
          title={name}
        >
          {isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0 text-stone-400" />}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="shrink-0 font-mono text-[11px] text-stone-400">{node.photoCount}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowActions(open => !open)}
          aria-expanded={showActions}
          aria-label={`Quản lý ${name}`}
          title={`Quản lý ${name}`}
          className="studio-folder-icon"
        >
          <Ellipsis className="h-4 w-4" />
        </button>
      </div>

      {showActions && (
        <div className="mt-1 flex flex-wrap justify-end gap-1 rounded-lg border border-studio-line bg-studio-raised px-2 py-1 text-[11px] text-stone-300">
          <button type="button" onClick={() => onCreateSubfolder(node.relPath, node.name)} className="studio-folder-action">
            <FolderPlus className="h-3.5 w-3.5" /> Thư mục con
          </button>
          {!isRoot && (
            <>
              <button type="button" onClick={() => onRenameFolder(node.relPath, node.name)} className="studio-folder-action">
                <Edit2 className="h-3.5 w-3.5" /> Đổi tên
              </button>
              <button type="button" onClick={() => onDeleteFolder(node.relPath, node.name)} className="studio-folder-action hover:!text-red-600">
                <Trash2 className="h-3.5 w-3.5" /> Xóa
              </button>
            </>
          )}
        </div>
      )}

      {hasChildren && isOpen && (
        <div className="ml-3 mt-1 space-y-1 border-l border-studio-line pl-1.5">
          {node.children.map(child => (
            <FolderTreeItem
              key={child.relPath}
              node={child}
              currentFolder={currentFolder}
              onSelectFolder={onSelectFolder}
              onCreateSubfolder={onCreateSubfolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onDropPhotos={onDropPhotos}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Virtual albums with their quota, shown under the folders. Clicking filters the gallery.
// Dropping photos on an album adds them to it (same as "Gán album", undoable).
function AlbumList({ virtualAlbums, filter, onChangeFilter, onOpenQuotaModal, onDropPhotosToAlbum }) {
  const [dragOverId, setDragOverId] = useState(null);
  const albums = Object.values(virtualAlbums || {});
  if (!albums.length) return null;

  const dropHandlers = albumId => onDropPhotosToAlbum ? {
    onDragOver: event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDragOverId(albumId);
    },
    onDragLeave: event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDragOverId(null);
    },
    onDrop: event => {
      event.preventDefault();
      setDragOverId(null);
      try {
        const payload = JSON.parse(event.dataTransfer.getData('application/json') || '{}');
        if (Array.isArray(payload.files) && payload.files.length) onDropPhotosToAlbum(albumId, payload.files);
      } catch (err) {
        console.error('Error handling album drop:', err);
      }
    },
  } : {};
  return (
    <section aria-labelledby="sidebar-albums" className="border-t border-studio-line px-2.5 pb-3 pt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 pl-1.5">
        <h2 id="sidebar-albums" className="studio-section-label flex items-center gap-1.5 !px-0">
          <Tag className="h-3.5 w-3.5" aria-hidden="true" /> Album
        </h2>
        {onOpenQuotaModal && (
          <button type="button" onClick={onOpenQuotaModal} className="studio-icon !h-7 !w-7" aria-label="Chỉnh chỉ tiêu album" title="Chỉnh chỉ tiêu album">
            <Target className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {albums.map(album => {
          const value = `album:${album.id}`;
          const active = filter === value;
          const count = album.photos?.length || 0;
          const full = album.quota > 0 && count >= album.quota;
          const percent = album.quota > 0 ? Math.min(100, Math.round((count / album.quota) * 100)) : 0;
          return (
            <button
              key={album.id}
              type="button"
              onClick={() => onChangeFilter(active ? 'all' : value)}
              aria-pressed={active}
              title={`${album.quota > 0 ? `${album.name}: ${count}/${album.quota} ảnh` : album.name} · Kéo ảnh vào đây để gắn album`}
              {...dropHandlers(album.id)}
              className={`studio-folder-row w-full !px-2 text-left ${active ? 'studio-folder-active' : ''} ${dragOverId === album.id ? 'ring-2 ring-rose-500' : ''}`}
            >
              <span aria-hidden="true" className="w-5 shrink-0 text-center text-sm">{ALBUM_ICONS[album.id] || '🏷️'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{album.name}</span>
                {album.quota > 0 && (
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-stone-800" aria-hidden="true">
                    <span className={`block h-full rounded-full ${full ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${percent}%` }} />
                  </span>
                )}
              </span>
              <span className={`flex shrink-0 items-center gap-0.5 font-mono text-[11px] ${full ? 'text-emerald-300' : 'text-stone-400'}`}>
                {count}{album.quota > 0 ? `/${album.quota}` : ''}
                {full && <Check className="h-3 w-3" aria-label="Đã đủ chỉ tiêu" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Sidebar({
  tree, currentFolder, onSelectFolder, onCreateSubfolder, onRenameFolder, onDeleteFolder, onDropPhotos, isOpen,
  virtualAlbums, filter, onChangeFilter, onOpenQuotaModal, onDropPhotosToAlbum,
}) {
  return (
    <aside id="photo-folders" aria-label="Thư mục và album" className={`studio-sidebar ${isOpen ? 'flex' : 'hidden'} md:flex`}>
      <div className="flex items-center justify-between gap-2 px-4 pb-1.5 pt-4">
        <h2 className="studio-section-label !px-0">Thư mục</h2>
        <button
          type="button"
          onClick={() => onCreateSubfolder(currentFolder, 'Thư mục hiện tại')}
          className="studio-icon !h-7 !w-7"
          aria-label="Tạo thư mục con"
          title="Tạo thư mục con"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-2.5 pb-3">
          {tree ? (
            <FolderTreeItem
              node={tree}
              currentFolder={currentFolder}
              onSelectFolder={onSelectFolder}
              onCreateSubfolder={onCreateSubfolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onDropPhotos={onDropPhotos}
            />
          ) : (
            <p className="px-3 py-4 text-xs text-stone-400">Đang tải thư mục…</p>
          )}
        </div>
        <AlbumList virtualAlbums={virtualAlbums} filter={filter} onChangeFilter={onChangeFilter} onOpenQuotaModal={onOpenQuotaModal} onDropPhotosToAlbum={onDropPhotosToAlbum} />
      </div>

      <p className="mx-4 mb-3 hidden items-center gap-1.5 text-[11px] text-stone-500 md:flex">
        <Grip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Kéo ảnh vào thư mục để chuyển, vào album để gắn
      </p>
    </aside>
  );
}
