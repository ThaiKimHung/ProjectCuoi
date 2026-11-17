import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Check, Trash2, Download, Plus, CircleDot, 
  HelpCircle, Sparkles, MessageSquare, Tag, Eye 
} from 'lucide-react';
import { savePhotoAnnotations } from '../api.js';
import { RETOUCH_PRESETS } from '../constants/retouchPresets.js';

export function AnnotationModal({
  isOpen,
  onClose,
  photo,
  onSuccessToast,
  onUpdatePhotoAnnotations,
}) {
  const [annotations, setAnnotations] = useState([]);
  const [selectedAnnoId, setSelectedAnnoId] = useState(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [circleColor, setCircleColor] = useState('#e11d48'); // rose-600
  const imageContainerRef = useRef(null);
  const imageRef = useRef(null);
  const saveTimerRef = useRef(null);
  const latestDataRef = useRef(annotations);

  useEffect(() => {
    latestDataRef.current = annotations;
  }, [annotations]);

  // Flush pending save to backend and update parent state immediately
  const flushSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (photo && latestDataRef.current) {
        const dataToSave = latestDataRef.current;
        savePhotoAnnotations(photo.relPath, dataToSave).catch(console.error);
        if (onUpdatePhotoAnnotations) {
          onUpdatePhotoAnnotations(photo.relPath, dataToSave);
        }
      }
    }
  };

  // Clean up debounce timer and flush save on unmount or when photo changes or modal closes
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [photo, isOpen]);

  // Handle closing modal with immediate save flush
  const handleClose = () => {
    flushSave();
    onClose();
  };

  // Escape key closes modal and flushes save
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, photo]);

  // Load existing annotations
  useEffect(() => {
    if (photo && isOpen) {
      setAnnotations(photo.annotations || []);
      setSelectedAnnoId(photo.annotations?.[0]?.id || null);
    }
  }, [photo, isOpen]);

  const cancelPendingSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const debouncedSave = (data) => {
    latestDataRef.current = data;
    cancelPendingSave();
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveAnnotationsToBackend(data);
    }, 450);
  };

  if (!isOpen || !photo) return null;

  const originalUrl = `/api/original?path=${encodeURIComponent(photo.relPath)}`;

  // Handle click on image to place new annotation
  const handleImageClick = (e) => {
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();

    // Calculate percentage coordinates
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Boundary check
    if (x < 0 || x > 100 || y < 0 || y > 100) return;

    // Next number
    const maxNum = annotations.reduce((max, a) => Math.max(max, a.number || 0), 0);
    const newNumber = maxNum + 1;

    const newAnno = {
      id: `anno_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      number: newNumber,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      radius: 4, // percentage
      text: '',
    };

    cancelPendingSave();
    const updated = [...annotations, newAnno];
    setAnnotations(updated);
    latestDataRef.current = updated;
    setSelectedAnnoId(newAnno.id);
    saveAnnotationsToBackend(updated); // Immediate save on click
  };

  const handleUpdateText = (id, text) => {
    const updated = annotations.map(a => a.id === id ? { ...a, text } : a);
    setAnnotations(updated);
    debouncedSave(updated); // Debounced save on typing
  };

  const handleUpdateRadius = (id, radius) => {
    const updated = annotations.map(a => a.id === id ? { ...a, radius: Number(radius) } : a);
    setAnnotations(updated);
    debouncedSave(updated);
  };

  const handleDelete = (id) => {
    cancelPendingSave(); // Cancel pending debounced save to prevent deleted item resurrection
    const remaining = annotations.filter(a => a.id !== id);
    const renumbered = remaining.map((a, idx) => ({ ...a, number: idx + 1 }));
    setAnnotations(renumbered);
    latestDataRef.current = renumbered;
    if (selectedAnnoId === id) {
      setSelectedAnnoId(renumbered[0]?.id || null);
    }
    saveAnnotationsToBackend(renumbered); // Immediate save on delete
  };

  const saveAnnotationsToBackend = async (data) => {
    try {
      await savePhotoAnnotations(photo.relPath, data);
      if (onUpdatePhotoAnnotations) {
        onUpdatePhotoAnnotations(photo.relPath, data);
      }
    } catch (err) {
      console.error('Error saving annotations:', err);
    }
  };

  // Generate and export Retouch PDF Brief
  const handleExportPDF = async () => {
    if (annotations.length === 0) {
      alert('Vui lòng khoanh ít nhất 1 điểm trên ảnh trước khi xuất PDF!');
      return;
    }

    setIsExportingPdf(true);

    try {
      // 1. Create an offscreen canvas to stamp annotations on high-res image
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = originalUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1920;
      canvas.height = img.naturalHeight || 1080;
      const ctx = canvas.getContext('2d');

      // Draw original image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Stamp annotations
      for (const anno of annotations) {
        const px = (anno.x / 100) * canvas.width;
        const py = (anno.y / 100) * canvas.height;
        const radiusPx = Math.max(30, (anno.radius / 100) * canvas.width);

        // Draw Outer Circle / Retouch Area
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, radiusPx, 0, 2 * Math.PI);
        ctx.lineWidth = Math.max(4, canvas.width * 0.0035);
        ctx.strokeStyle = '#e11d48'; // rose-600
        ctx.stroke();

        ctx.fillStyle = 'rgba(225, 29, 72, 0.15)';
        ctx.fill();

        // Draw Center Number Badge
        const badgeRadius = Math.max(22, canvas.width * 0.016);
        ctx.beginPath();
        ctx.arc(px, py, badgeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#e11d48';
        ctx.fill();
        ctx.lineWidth = Math.max(2, canvas.width * 0.002);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Draw Number Text
        ctx.font = `bold ${Math.round(badgeRadius * 1.2)}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(anno.number), px, py);

        ctx.restore();
      }

      const stampedImgData = canvas.toDataURL('image/jpeg', 0.9);

      // 2. Initialize PDF Document (A4 portrait: 210 x 297 mm)
      // Loaded on demand: jspdf (and html2canvas behind it) is most of the bundle.
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;

      // Header Banner
      pdf.setFillColor(15, 23, 42); // slate-900
      pdf.rect(0, 0, pageWidth, 28, 'F');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(244, 63, 94); // rose-500
      pdf.text('YEU CAU CHINH SUA RETOUCH ANH CUOI', margin, 12);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(203, 213, 225); // slate-300
      pdf.text(`File anh: ${photo.name}   |   Thu muc: ${photo.relPath}   |   Ngay: ${new Date().toLocaleDateString('vi-VN')}`, margin, 20);

      // Add Stamped Image
      const maxImgWidth = pageWidth - margin * 2;
      const maxImgHeight = 135; // mm
      const imgAspect = canvas.width / canvas.height;
      let renderW = maxImgWidth;
      let renderH = renderW / imgAspect;

      if (renderH > maxImgHeight) {
        renderH = maxImgHeight;
        renderW = renderH * imgAspect;
      }

      const imgX = (pageWidth - renderW) / 2;
      const imgY = 32;

      pdf.addImage(stampedImgData, 'JPEG', imgX, imgY, renderW, renderH);

      // Section: Retouch Checklist Title
      const tableStartY = imgY + renderH + 8;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(15, 23, 42);
      pdf.text(`DANH SACH DIEM KHOANH & YEU CAU CHI TIET (${annotations.length} vi tri):`, margin, tableStartY);

      // Table Header
      let curY = tableStartY + 5;
      pdf.setFillColor(241, 245, 249);
      pdf.rect(margin, curY, pageWidth - margin * 2, 7, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(71, 85, 105);
      pdf.text('DIEM', margin + 4, curY + 5);
      pdf.text('CHI TIET YEU CAU CHINH SUA', margin + 26, curY + 5);

      curY += 8;

      // Table Rows
      for (const anno of annotations) {
        // If reaching bottom of page, add new page
        if (curY > pageHeight - 20) {
          pdf.addPage();
          curY = 20;
        }

        // Row background alternating
        pdf.setFillColor(anno.number % 2 === 0 ? 250 : 255, anno.number % 2 === 0 ? 250 : 255, 255);
        pdf.roundedRect(margin, curY - 1, pageWidth - margin * 2, 9, 1, 1, 'F');

        // Number Badge
        pdf.setFillColor(225, 29, 72); // rose-600
        pdf.circle(margin + 8, curY + 3.5, 3.5, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.text(String(anno.number), margin + 8, curY + 4.5, { align: 'center' });

        // Note Text
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(30, 41, 59);
        const noteContent = anno.text.trim() || '(Chua co ghi chu chi tiet)';
        pdf.text(noteContent, margin + 26, curY + 4.5);

        curY += 10;
      }

      // Footer
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text('Xuat boi Wedding Photo Curator - Local Retouch Workflow', margin, pageHeight - 6);

      // Save PDF file
      const safeName = photo.name.replace(/\.[^/.]+$/, '');
      pdf.save(`Retouch_Brief_${safeName}.pdf`);

      if (onSuccessToast) {
        onSuccessToast(`Đã xuất file Retouch_Brief_${safeName}.pdf thành công!`);
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi khi xuất PDF: ' + err.message);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const selectedAnno = annotations.find(a => a.id === selectedAnnoId);

  return (
    <div className="theme-dark fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-2 md:p-4 select-none">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full h-[95vh] max-w-7xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="h-14 px-6 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
              <CircleDot className="w-5 h-5 text-rose-500 animate-pulse" />
              <span>Khoanh vùng và ghi chú retouch</span>
            </div>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <span className="text-xs text-slate-300 font-mono truncate max-w-xs" title={photo.name}>
              {photo.name}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[11px] font-bold">
              {annotations.length} vị trí khoanh
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Export PDF Button */}
            <button
              onClick={handleExportPDF}
              disabled={isExportingPdf || annotations.length === 0}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-paper text-xs font-bold rounded-xl shadow-lg shadow-rose-950/60 transition flex items-center gap-2"
              title="Xuất file PDF đẹp mắt kèm ảnh khoanh vùng và bảng ghi chú để gửi cho thợ ảnh"
            >
              <Download className="w-4 h-4" />
              <span>{isExportingPdf ? 'Đang tạo PDF...' : 'Xuất File PDF Gửi Thợ'}</span>
            </button>

            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Body: Image Viewport (Left) + Notes Sidebar (Right) */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Left Viewport: Interactive Image */}
          <div 
            ref={imageContainerRef}
            className="flex-1 relative bg-slate-950 flex items-center justify-center overflow-hidden p-4 min-h-[300px] cursor-crosshair"
          >
            {/* Tip Overlay */}
            <div className="absolute top-4 left-4 z-20 bg-slate-900/80 backdrop-blur border border-slate-700 px-3 py-1.5 rounded-xl text-[11px] text-slate-300 pointer-events-none flex items-center gap-1.5">
              <span className="text-rose-400 font-bold">👆 Click lên ảnh</span>
              <span>để đánh dấu vị trí cần sửa!</span>
            </div>

            {/* Image & SVG Annotations wrapper */}
            <div className="relative inline-block max-w-full max-h-full" onClick={handleImageClick}>
              <img
                ref={imageRef}
                src={originalUrl}
                alt={photo.name}
                className="max-h-[calc(95vh-160px)] max-w-full object-contain rounded-xl shadow-2xl block select-none pointer-events-auto"
              />

              {/* SVG Markers Layer */}
              <svg 
                className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
              >
                {annotations.map((anno) => {
                  const isSelected = anno.id === selectedAnnoId;
                  return (
                    <g 
                      key={anno.id} 
                      className="pointer-events-auto cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAnnoId(anno.id);
                      }}
                    >
                      {/* Retouch Area Circle */}
                      <circle
                        cx={`${anno.x}%`}
                        cy={`${anno.y}%`}
                        r={`${anno.radius}%`}
                        fill="rgba(225, 29, 72, 0.18)"
                        stroke="#e11d48"
                        strokeWidth={isSelected ? '3' : '2'}
                        strokeDasharray={isSelected ? '4 2' : 'none'}
                        className="transition-all duration-150"
                      />

                      {/* Center Pin / Badge */}
                      <circle
                        cx={`${anno.x}%`}
                        cy={`${anno.y}%`}
                        r="16"
                        fill="#e11d48"
                        stroke="#ffffff"
                        strokeWidth="2.5"
                        className={`drop-shadow-lg ${isSelected ? 'scale-125' : 'hover:scale-110'} transition-transform`}
                      />

                      {/* Number Text */}
                      <text
                        x={`${anno.x}%`}
                        y={`${anno.y}%`}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#ffffff"
                        fontSize="12"
                        fontWeight="bold"
                        fontFamily="sans-serif"
                      >
                        {anno.number}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Right Sidebar: Numbered Retouch Notes List */}
          <div className="w-full lg:w-96 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col h-full shrink-0">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-rose-400" />
                <span>Ghi chú theo số ({annotations.length})</span>
              </h3>
            </div>

            {/* List of notes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {annotations.length === 0 ? (
                <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <CircleDot className="w-12 h-12 text-slate-700 mb-3 animate-pulse" />
                  <p className="text-xs font-medium text-slate-400 mb-1">Chưa có vị trí khoanh nào</p>
                  <p className="text-[11px] text-slate-500">
                    Bấm trực tiếp vào ảnh ở bên trái (mặt, eo, váy, người phía sau...) để tạo điểm khoanh số 1, 2, 3...
                  </p>
                </div>
              ) : (
                annotations.map((anno) => {
                  const isSelected = anno.id === selectedAnnoId;
                  return (
                    <div
                      key={anno.id}
                      onClick={() => setSelectedAnnoId(anno.id)}
                      className={`p-3.5 rounded-2xl border transition-all ${
                        isSelected
                          ? 'bg-rose-950/20 border-rose-500 ring-1 ring-rose-500/40 shadow-md'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-rose-600 text-paper font-bold text-xs flex items-center justify-center shadow">
                            {anno.number}
                          </span>
                          <span className="text-xs font-semibold text-slate-200">
                            Điểm số {anno.number}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            ({Math.round(anno.x)}%, {Math.round(anno.y)}%)
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(anno.id);
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                          title="Xoá điểm này"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Note text input */}
                      <input
                        type="text"
                        value={anno.text}
                        onChange={(e) => handleUpdateText(anno.id, e.target.value)}
                        placeholder={`Yêu cầu sửa cho điểm ${anno.number} (VD: bóp eo, xoá mụn)...`}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500 mb-2"
                      />

                      {/* Circle radius slider */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <span>Độ rộng khoanh:</span>
                        <input
                          type="range"
                          min="2"
                          max="15"
                          step="0.5"
                          value={anno.radius}
                          onChange={(e) => handleUpdateRadius(anno.id, e.target.value)}
                          className="w-28 accent-rose-500 cursor-pointer"
                        />
                        <span className="font-mono text-[10px] w-6 text-right">{anno.radius}%</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Suggestions Tags */}
            {selectedAnno && (
              <div className="p-3 border-t border-slate-800 bg-slate-950/60 shrink-0">
                <div className="text-[10px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-rose-400" />
                  <span>Gợi ý retouch nhanh cho điểm {selectedAnno.number}:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {RETOUCH_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        const current = selectedAnno.text.trim();
                        const next = current ? `${current}, ${preset.text}` : preset.text;
                        handleUpdateText(selectedAnno.id, next);
                      }}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 hover:text-white rounded-lg border border-slate-700 transition"
                      title={preset.text}
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
