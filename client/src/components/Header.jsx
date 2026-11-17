import React, { useEffect, useRef, useState } from 'react';
import { Aperture, Archive, Copy, Ellipsis, EyeOff, FileText, Folder, Redo2, Send, Settings, Undo2 } from 'lucide-react';

export function Header({
  isInactive,
  sidebarOpen,
  sidebarToggleRef,
  onToggleSidebar,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenSettings,
  onOpenStateModal,
  onOpenExportModal,
  onOpenDuplicates,
  onOpenBackup,
  onOpenResetViewed,
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);
  const toolsButtonRef = useRef(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const closeOutside = event => {
      if (!toolsRef.current?.contains(event.target)) setToolsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [toolsOpen]);

  const runTool = action => {
    setToolsOpen(false);
    toolsButtonRef.current?.focus();
    action();
  };

  const toolClass = 'flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-stone-200 hover:bg-white/10 disabled:opacity-50';

  return (
    <header inert={isInactive ? '' : undefined} className="studio-header">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="studio-logo" aria-hidden="true">
          <Aperture className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-stone-100">Wedding Curator</div>
          <div className="hidden text-[11px] text-stone-400 sm:block">Chọn và phân loại ảnh cưới</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          ref={sidebarToggleRef}
          type="button"
          onClick={onToggleSidebar}
          aria-label="Thư mục"
          aria-expanded={sidebarOpen}
          aria-controls="photo-folders"
          title="Thư mục"
          className="studio-icon md:hidden"
        >
          <Folder className="h-4 w-4" />
        </button>

        <div className="flex items-center rounded-lg border border-studio-line">
          <button type="button" onClick={onUndo} disabled={!canUndo} className="studio-icon" aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z / Cmd+Z)">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo} className="studio-icon" aria-label="Làm lại" title="Làm lại (Ctrl+Y / Cmd+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={toolsRef}
          className="relative"
          onKeyDown={event => {
            if (event.key !== 'Escape' || !toolsOpen) return;
            event.stopPropagation();
            setToolsOpen(false);
            toolsButtonRef.current?.focus();
          }}
        >
          <button
            ref={toolsButtonRef}
            type="button"
            onClick={() => setToolsOpen(open => !open)}
            className="studio-icon"
            aria-label="Công cụ thư viện"
            aria-expanded={toolsOpen}
            aria-controls={toolsOpen ? 'library-tools' : undefined}
            title="Công cụ thư viện"
          >
            <Ellipsis className="h-5 w-5" />
          </button>
          {toolsOpen && (
            <div id="library-tools" className="absolute right-0 top-full z-30 mt-2 w-48 space-y-0.5 rounded-xl border border-studio-line bg-[var(--studio-panel)] p-1.5 shadow-xl">
              <button type="button" onClick={() => runTool(onOpenDuplicates)} disabled={!onOpenDuplicates} className={toolClass}>
                <Copy className="h-4 w-4 text-rose-300" aria-hidden="true" /> Tìm ảnh trùng
              </button>
              <button type="button" onClick={() => runTool(onOpenBackup)} disabled={!onOpenBackup} className={toolClass}>
                <Archive className="h-4 w-4 text-rose-300" aria-hidden="true" /> Sao lưu và khôi phục
              </button>
              <button type="button" onClick={() => runTool(onOpenResetViewed)} disabled={!onOpenResetViewed} className={toolClass}>
                <EyeOff className="h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" /> Đặt lại trạng thái đã xem
              </button>
              <button type="button" onClick={() => runTool(onOpenStateModal)} className={toolClass}>
                <FileText className="h-4 w-4 text-stone-400" aria-hidden="true" /> Dữ liệu trạng thái
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={onOpenSettings} className="studio-icon" aria-label="Cài đặt" title="Cài đặt thư mục ảnh">
          <Settings className="h-4 w-4" />
        </button>
        <button type="button" onClick={onOpenExportModal} className="studio-primary" aria-label="Xuất cho studio" title="Xuất cho studio">
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">Xuất cho studio</span>
        </button>
      </div>
    </header>
  );
}
