import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  fetchConfig, updateConfig, fetchTree, fetchPhotos, 
  createFolder, renameFolder, deleteFolder, movePhotos, movePhotoGroups, undoPhotoMove, 
  markPhotosViewed, resetViewedPhotos, toggleFavorite, saveNote, fetchViewedState,
  generateSamplePhotos, setPhotosTriage, togglePhotoInAlbum,
  setAlbumMembership, createVirtualAlbum, deleteVirtualAlbum, updateAlbumQuota, saveUserSession
} from './api.js';

import { EyeOff, Play, X } from 'lucide-react';

import { Header } from './components/Header.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { Gallery } from './components/Gallery.jsx';
import { Lightbox } from './components/Lightbox.jsx';
import { CompareModal } from './components/CompareModal.jsx';
import {
  buildComparisonCandidatePool,
  getPhotoDirectory,
  resolveComparisonFolder,
  resolveComparisonPair,
} from './components/comparePhotoPicker.js';
import { ExportModal } from './components/ExportModal.jsx';
import { AnnotationModal } from './components/AnnotationModal.jsx';
import { QuotaModal } from './components/QuotaModal.jsx';
import { DuplicatePhotosModal } from './components/DuplicatePhotosModal.jsx';
import { CollectionBackupModal } from './components/CollectionBackupModal.jsx';
import { DialogShell } from './components/DialogShell.jsx';
import { findBurstNeighbor } from './photoBurst.js';
import { addPhotoSelectionRange } from './photoSelection.js';
import { useBackToClose } from './useBackToClose.js';
import {
  captureReviewScroll, discardPendingReviewSession, moveReviewCheckpoint, readPendingReviewSession,
  readReviewCheckpoint, remapFolderPath, rememberPendingReviewSession, restoreReviewScroll, reviewContext,
} from './reviewCheckpoint.js';
import { 
  CreateFolderModal, RenameFolderModal, DeleteFolderModal, 
  MoveModal, SettingsModal, StateViewModal, RangeGroupModal 
} from './components/Modals.jsx';

// Helper to flatten recursive tree into list with depths
function flattenTree(node, depth = 0) {
  if (!node) return [];
  const list = [{
    id: node.id,
    name: depth === 0 ? 'Thư mục gốc (Root)' : node.name,
    relPath: node.relPath,
    photoCount: node.photoCount,
    depth,
  }];

  if (node.children) {
    for (const child of node.children) {
      list.push(...flattenTree(child, depth + 1));
    }
  }
  return list;
}

export default function App() {
  // App State
  const [config, setConfig] = useState(null);
  const [tree, setTree] = useState(null);
  const [currentFolder, setCurrentFolder] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarToggleRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(true);
  const [stats, setStats] = useState({ 
    totalCount: 0, 
    viewedCount: 0, 
    favoriteCount: 0,
    pickedCount: 0,
    maybeCount: 0,
    rejectedCount: 0,
    unassignedPickCount: 0,
    notedCount: 0,
    burstCount: 0,
  });
  const [virtualAlbums, setVirtualAlbums] = useState({});
  const [restoredCollection, setRestoredCollection] = useState(null);
  const restoredCollectionRef = useRef(null);
  const photosDir = config?.photosDir;
  const [reviewCheckpoint, setReviewCheckpoint] = useState(null);
  const [resumeRequest, setResumeRequest] = useState(null);
  const [retainedPhoto, setRetainedPhoto] = useState(null);
  const [loadedGalleryKey, setLoadedGalleryKey] = useState(null);
  const [failedGalleryKey, setFailedGalleryKey] = useState(null);
  const galleryScrollRef = useRef(null);
  const sessionWriteRef = useRef(Promise.resolve());
  const sessionVersionRef = useRef(0);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [allProjectPhotos, setAllProjectPhotos] = useState([]);
  const loadRequestIdRef = useRef(0);
  
  // Filter & Sort & Search
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name-asc');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selection
  const [selectedFiles, setSelectedFiles] = useState([]);
  const selectionAnchorRef = useRef(null);
  const batchAlbumBusyRef = useRef(false);
  const [isBatchAlbumPending, setIsBatchAlbumPending] = useState(false);
  
  // Lightbox - Tracks active photo strictly by relPath (Fix for issue #4)
  const [activePhotoPath, setActivePhotoPath] = useState(null);

  const currentFolderRef = useRef(currentFolder);
  const filterRef = useRef(filter);
  const sortRef = useRef(sort);
  const galleryKey = JSON.stringify([photosDir, currentFolder, filter, sort]);

  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);

  useEffect(() => {
    filterRef.current = filter;
    sortRef.current = sort;
  }, [filter, sort]);

  // Modals state
  const [createModal, setCreateModal] = useState({ isOpen: false, parentPath: '', parentName: '' });
  const [renameModal, setRenameModal] = useState({ isOpen: false, folderPath: '', currentName: '' });
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, folderPath: '', name: '' });
  const [moveModal, setMoveModal] = useState({ isOpen: false, files: [] });
  // Keyboard cursor on the photo grid; follows the last photo opened in the Lightbox.
  const [gridCursor, setGridCursor] = useState(null);
  const [rangeModal, setRangeModal] = useState(false);
  const [moveNotice, setMoveNotice] = useState(null);
  const [movePending, setMovePending] = useState(false);
  const movePendingRef = useRef(false);
  const [compareModal, setCompareModal] = useState({ isOpen: false, photoA: null, photoB: null });
  const compareRequestIdRef = useRef(0);
  const [exportModal, setExportModal] = useState(false);
  const [packageSnapshot, setPackageSnapshot] = useState(null);
  const [isLoadingPackagePhotos, setIsLoadingPackagePhotos] = useState(false);
  const [packagePhotosError, setPackagePhotosError] = useState(null);
  const exportRequestIdRef = useRef(0);
  const [annotationModal, setAnnotationModal] = useState({ isOpen: false, photo: null });
  const [settingsModal, setSettingsModal] = useState(false);
  const [stateModal, setStateModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [backupModal, setBackupModal] = useState(false);
  const [resetViewedModal, setResetViewedModal] = useState(false);
  const [isResettingViewed, setIsResettingViewed] = useState(false);
  const [resetViewedError, setResetViewedError] = useState('');
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const [rawStateData, setRawStateData] = useState(null);

  // Toast notification
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = (message, type = 'success') => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // Load Tree and Global Config
  const loadInitialData = async () => {
    try {
      const cfg = await fetchConfig();
      setConfig({ ...cfg.config, collectionId: cfg.collectionId });

      const treeRes = await fetchTree();
      setTree(treeRes.tree);
    } catch (err) {
      console.error('Error loading initial data:', err);
      showToast('Lỗi khi tải cấu hình hoặc thư mục', 'error');
    }
  };

  // Load photos in current folder (Protected against race conditions where stale response overwrites new folder)
  const loadPhotos = useCallback(async (folder = currentFolder, f = filter, s = sort) => {
    if (!photosDir) return;
    const requestKey = JSON.stringify([photosDir, folder, f, s]);
    const requestId = ++loadRequestIdRef.current;
    setIsLoadingPhotos(true);
    setFailedGalleryKey(null);
    try {
      const res = await fetchPhotos(folder, f, s);
      if (requestId !== loadRequestIdRef.current) {
        // Discard stale response from an earlier request to avoid overwriting newer folder data
        return;
      }
      setLoadedGalleryKey(requestKey);
      setPhotos(res.photos || []);
      if ((folder === '' || !folder) && (f === 'all' || !f)) {
        setAllProjectPhotos(res.photos || []);
      }
      setStats({
        totalCount: res.totalCount || 0,
        viewedCount: res.viewedCount || 0,
        favoriteCount: res.favoriteCount || 0,
        pickedCount: res.pickedCount || 0,
        maybeCount: res.maybeCount || 0,
        rejectedCount: res.rejectedCount || 0,
        unassignedPickCount: res.unassignedPickCount || 0,
        notedCount: res.notedCount || 0,
        burstCount: res.burstCount || 0,
      });
      if (res.virtualAlbums) {
        setVirtualAlbums(res.virtualAlbums);
      }
      if (restoredCollectionRef.current !== photosDir) {
        restoredCollectionRef.current = photosDir;
        setRestoredCollection(photosDir);
        const session = readPendingReviewSession(photosDir, res.session || {});
        sessionVersionRef.current = Math.max(sessionVersionRef.current, session.clientUpdatedAt || 0);
        const context = reviewContext({
          folder: session.activeFolder,
          filter: session.activeFilter,
          sort: session.activeSort,
          searchQuery: session.activeSearchQuery,
        });
        const savedCheckpoint = readReviewCheckpoint(session.reviewCheckpoint);
        const legacyCheckpoint = readReviewCheckpoint({ ...context, photoPath: session.lastActivePhoto });
        setReviewCheckpoint(savedCheckpoint || legacyCheckpoint);
        setCurrentFolder(context.folder);
        setFilter(context.filter);
        setSort(context.sort);
        setSearchQuery(context.searchQuery);
        if (session.lastActivePhoto && legacyCheckpoint) {
          const resume = savedCheckpoint?.photoPath === session.lastActivePhoto ? savedCheckpoint : legacyCheckpoint;
          setCurrentFolder(resume.folder);
          setFilter(resume.filter);
          setSort(resume.sort);
          setSearchQuery(resume.searchQuery);
          setResumeRequest(resume);
        }
      }
      // Clear selections that might no longer exist
      selectionAnchorRef.current = null;
      setSelectedFiles([]);
    } catch (err) {
      if (requestId === loadRequestIdRef.current) {
        setFailedGalleryKey(requestKey);
        console.error('Error loading photos:', err);
        showToast('Lỗi khi nạp ảnh trong thư mục', 'error');
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setIsLoadingPhotos(false);
    }
  }, [currentFolder, filter, sort, photosDir]);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadPhotos(currentFolder, filter, sort);
  }, [currentFolder, filter, sort, loadPhotos]);

  const loadPackagePhotos = async () => {
    const requestId = ++exportRequestIdRef.current;
    setIsLoadingPackagePhotos(true);
    setPackagePhotosError(null);
    try {
      const result = await fetchPhotos('', 'all', sort);
      if (requestId === exportRequestIdRef.current) {
        setPackageSnapshot({ photos: result.photos || [], albums: result.virtualAlbums || virtualAlbums });
      }
    } catch (error) {
      if (requestId === exportRequestIdRef.current) {
        console.error('Error fetching photos for studio export:', error);
        setPackagePhotosError('Không thể tải danh sách ảnh để rà soát.');
      }
    } finally {
      if (requestId === exportRequestIdRef.current) setIsLoadingPackagePhotos(false);
    }
  };

  const handleOpenExport = () => {
    setExportModal(true);
    loadPackagePhotos();
  };

  const handleCloseExport = () => {
    exportRequestIdRef.current += 1;
    setExportModal(false);
    setPackageSnapshot(null);
  };

  // Refresh tree
  const refreshTree = async () => {
    try {
      const treeRes = await fetchTree();
      setTree(treeRes.tree);
    } catch (err) {
      console.error('Error refreshing tree:', err);
    }
  };

  // Flattened folders for Move modal
  const flatFolders = useMemo(() => {
    return flattenTree(tree);
  }, [tree]);

  const selectedPhotoObjects = useMemo(() => photos.filter(p => selectedFiles.includes(p.relPath)), [photos, selectedFiles]);

  // Derived displayed photos taking search query into account (Fix for issues #5 and #6)
  const displayedPhotos = useMemo(() => {
    if (!searchQuery.trim()) return photos;
    const q = searchQuery.trim().toLowerCase();
    return photos.filter(p => p.name.toLowerCase().includes(q));
  }, [photos, searchQuery]);

  useEffect(() => {
    if (!resumeRequest || isLoadingPhotos) return;
    if (failedGalleryKey === galleryKey) {
      setResumeRequest(null);
      return;
    }
    if (loadedGalleryKey !== galleryKey) return;
    const expectedKey = JSON.stringify([photosDir, resumeRequest.folder, resumeRequest.filter, resumeRequest.sort]);
    if (loadedGalleryKey !== expectedKey) return;

    let cancelled = false;
    const openCheckpoint = (photo) => {
      if (cancelled) return;
      restoreReviewScroll(galleryScrollRef.current, resumeRequest);
      setRetainedPhoto({ photo, index: resumeRequest.photoIndex });
      setActivePhotoPath(photo.relPath);
      setResumeRequest(null);
    };
    const visiblePhoto = displayedPhotos.find(photo => photo.relPath === resumeRequest.photoPath);
    if (visiblePhoto) {
      openCheckpoint(visiblePhoto);
    } else {
      fetchPhotos(resumeRequest.folder, 'all', resumeRequest.sort).then(result => {
        if (cancelled) return;
        const photo = result.photos?.find(item => item.relPath === resumeRequest.photoPath);
        if (photo) {
          openCheckpoint(photo);
        } else {
          setReviewCheckpoint(null);
          setResumeRequest(null);
          showToast('Ảnh ở điểm duyệt trước không còn trong thư mục.', 'error');
        }
      }).catch(() => {
        if (cancelled) return;
        setResumeRequest(null);
        showToast('Không thể mở lại ảnh đang duyệt. Hãy thử lại.', 'error');
      });
    }
    return () => { cancelled = true; };
  }, [resumeRequest, photosDir, galleryKey, loadedGalleryKey, failedGalleryKey, isLoadingPhotos, displayedPhotos]);

  const handleResumeReview = () => {
    if (!reviewCheckpoint || resumeRequest) return;
    compareRequestIdRef.current += 1;
    setCurrentFolder(reviewCheckpoint.folder);
    setFilter(reviewCheckpoint.filter);
    setSort(reviewCheckpoint.sort);
    setSearchQuery(reviewCheckpoint.searchQuery);
    setResumeRequest(reviewCheckpoint);
  };

  // Handle Folder selection
  const handleSelectFolder = (relPath) => {
    compareRequestIdRef.current += 1;
    setResumeRequest(null);
    setRetainedPhoto(null);
    setCurrentFolder(relPath);
    setActivePhotoPath(null);
  };

  const handleSelectSidebarFolder = (relPath) => {
    handleSelectFolder(relPath);
    if (sidebarOpen) {
      setSidebarOpen(false);
      sidebarToggleRef.current?.focus();
    }
  };

  // Handle Subfolder creation
  const handleCreateSubfolder = async (parentPath, name) => {
    try {
      await createFolder(parentPath, name);
      setCreateModal({ isOpen: false, parentPath: '', parentName: '' });
      showToast(`Đã tạo thư mục "${name}" thành công!`);
      await refreshTree();
    } catch (err) {
      showToast(err.message || 'Lỗi khi tạo thư mục', 'error');
    }
  };

  const remapReviewFolder = (oldFolder, newFolder) => {
    setReviewCheckpoint(checkpoint => {
      if (!checkpoint) return null;
      const photoPath = remapFolderPath(checkpoint.photoPath, oldFolder, newFolder);
      const folder = remapFolderPath(checkpoint.folder, oldFolder, newFolder);
      if (photoPath === null || folder === null) return null;
      const anchorPath = remapFolderPath(checkpoint.anchorPath, oldFolder, newFolder);
      return { ...checkpoint, photoPath, folder, anchorPath };
    });
  };

  // Handle Folder rename
  const handleRenameFolder = async (folderPath, newName) => {
    try {
      await sessionWriteRef.current;
      const res = await renameFolder(folderPath, newName);
      setRenameModal({ isOpen: false, folderPath: '', currentName: '' });
      showToast(`Đã đổi tên thư mục thành "${newName}"`);
      remapReviewFolder(folderPath, res.newRelPath);
      const selectedFolder = currentFolderRef.current;
      const nextFolder = remapFolderPath(selectedFolder, folderPath, res.newRelPath);
      setCurrentFolder(nextFolder);
      await refreshTree();
      if (nextFolder === selectedFolder) await loadPhotos(nextFolder, filterRef.current, sortRef.current);
    } catch (err) {
      showToast(err.message || 'Lỗi khi đổi tên thư mục', 'error');
    }
  };

  // Handle Folder delete
  const handleDeleteFolder = async (folderPath) => {
    try {
      await sessionWriteRef.current;
      await deleteFolder(folderPath);
      setDeleteModal({ isOpen: false, folderPath: '', name: '' });
      showToast('Đã xoá thư mục thành công');
      remapReviewFolder(folderPath, null);
      const selectedFolder = currentFolderRef.current;
      const nextFolder = remapFolderPath(selectedFolder, folderPath, null) ?? '';
      setCurrentFolder(nextFolder);
      await refreshTree();
      if (nextFolder === selectedFolder) await loadPhotos(nextFolder, filterRef.current, sortRef.current);
    } catch (err) {
      showToast(err.message || 'Lỗi khi xoá thư mục', 'error');
    }
  };

  // nextActivePath: when the photo open in the viewer is moved, show this one instead of closing.
  const updateGalleryAfterMove = async (moves, { nextActivePath = null } = {}) => {
    setReviewCheckpoint(checkpoint => moveReviewCheckpoint(checkpoint, moves));
    const replacement = nextActivePath && !moves.has(nextActivePath) ? nextActivePath : null;
    setActivePhotoPath(path => moves.has(path) ? replacement : path);
    setRetainedPhoto(current => current && moves.has(current.photo.relPath) ? null : current);
    await refreshTree();
    await loadPhotos(currentFolderRef.current, filterRef.current, sortRef.current);
  };

  const runPhotoMove = async (request, describe, options = {}) => {
    if (movePendingRef.current || batchAlbumBusyRef.current) return false;
    movePendingRef.current = true;
    setMovePending(true);
    try {
      await sessionWriteRef.current;
      const result = await request();
      const changed = result.results.filter(item => item.success && item.oldPath !== item.newPath);
      const failures = result.results.filter(item => !item.success || item.warning);
      setMoveModal({ isOpen: false, files: [] });
      if (changed.length === 0) {
        showToast(failures[0]?.error || 'Ảnh đã ở thư mục đích.', failures.length ? 'error' : 'success');
        return true;
      }

      setMoveNotice({ message: describe(changed.length), failures, undoToken: result.undoToken });
      await updateGalleryAfterMove(new Map(changed.map(item => [item.oldPath, item.newPath])), options);
      return true;
    } catch (err) {
      showToast(err.message || 'Lỗi khi chuyển ảnh', 'error');
      return false;
    } finally {
      movePendingRef.current = false;
      setMovePending(false);
    }
  };

  // The photo to show next in the viewer if the one open there is being moved.
  const nextViewerPathAfterMove = (files) => {
    if (!activePhotoPath || !files.includes(activePhotoPath)) return null;
    const moving = new Set(files);
    const index = displayedPhotos.findIndex(photo => photo.relPath === activePhotoPath);
    if (index < 0) return null;
    for (let i = index + 1; i < displayedPhotos.length; i++) {
      if (!moving.has(displayedPhotos[i].relPath)) return displayedPhotos[i].relPath;
    }
    for (let i = index - 1; i >= 0; i--) {
      if (!moving.has(displayedPhotos[i].relPath)) return displayedPhotos[i].relPath;
    }
    return null;
  };

  const handleMovePhotos = (files, targetFolder) => runPhotoMove(
    () => movePhotos(files, targetFolder),
    count => `Đã chuyển ${count} ảnh vào “${targetFolder || 'Thư mục gốc'}”.`,
    { nextActivePath: nextViewerPathAfterMove(files) },
  );

  // Range dialog: one or more groups, each into its own folder, undone together.
  const handleGroupRange = async (groups) => {
    const moved = await runPhotoMove(
      () => movePhotoGroups(groups),
      count => groups.length === 1
        ? `Đã gom ${count} ảnh vào “${groups[0].label}”.`
        : `Đã gom ${count} ảnh vào ${groups.length} thư mục: ${groups.map(group => group.label).join(', ')}.`,
    );
    if (moved) {
      setRangeModal(false);
      setSelectedFiles([]);
    }
  };

  const handleSelectRange = (files) => {
    setSelectedFiles(files);
    setRangeModal(false);
    showToast(`Đã chọn ${files.length} ảnh — dùng thanh công cụ để gán album, đánh giá hoặc chuyển.`);
  };

  const handleUndoMove = async () => {
    if (movePendingRef.current || batchAlbumBusyRef.current || !moveNotice?.undoToken) return;
    movePendingRef.current = true;
    setMovePending(true);
    try {
      await sessionWriteRef.current;
      const result = await undoPhotoMove(moveNotice.undoToken);
      const restored = result.results.filter(item => item.success);
      const failures = result.results.filter(item => !item.success || item.warning);
      const message = restored.length ? `Đã trả ${restored.length} ảnh về thư mục cũ.` : 'Chưa thể hoàn tác chuyển ảnh.';
      setMoveNotice({
        message,
        failures,
        undoToken: result.remainingCount > 0 ? moveNotice.undoToken : null,
      });
      if (restored.length) await updateGalleryAfterMove(new Map(restored.map(item => [item.oldPath, item.newPath])));
    } catch (err) {
      if (err.status === 404) {
        setMoveNotice({ message: err.message, failures: [], undoToken: null });
      } else {
        showToast(err.message || 'Lỗi khi hoàn tác chuyển ảnh', 'error');
      }
    } finally {
      movePendingRef.current = false;
      setMovePending(false);
    }
  };

  // Writes are ordered so a rapid series of photos leaves the latest checkpoint on disk.
  useEffect(() => {
    if (!photosDir || restoredCollection !== photosDir || resumeRequest || backupModal) return;
    sessionVersionRef.current = Math.max(Date.now(), sessionVersionRef.current + 1);
    const session = {
      clientUpdatedAt: sessionVersionRef.current,
      activeFolder: currentFolder,
      activeFilter: filter,
      activeSort: sort,
      activeSearchQuery: searchQuery,
      lastActivePhoto: activePhotoPath,
      reviewCheckpoint,
    };
    const clearPending = rememberPendingReviewSession(photosDir, session);
    sessionWriteRef.current = sessionWriteRef.current
      .then(() => sessionVersionRef.current === session.clientUpdatedAt
        ? saveUserSession(session, photosDir).then(clearPending)
        : undefined)
      .catch(error => console.error('Failed to save session:', error));
  }, [photosDir, restoredCollection, resumeRequest, backupModal, currentFolder, filter, sort, searchQuery, activePhotoPath, reviewCheckpoint]);

  const updateRetainedPhoto = update => {
    setRetainedPhoto(current => {
      if (!current) return current;
      const photo = update(current.photo);
      return photo === current.photo ? current : { ...current, photo };
    });
  };

  const updatePhotoMetadata = (relPath, metadata) => {
    const update = photo => photo.relPath === relPath ? { ...photo, ...metadata } : photo;
    setPhotos(previous => previous.map(update));
    setAllProjectPhotos(previous => previous.map(update));
    updateRetainedPhoto(update);
  };

  // Handle Wedding Photo Triage (Pick / Maybe / Reject)
  const handleSetTriage = async (files, status, pushToUndo = true, clearRedo = true) => {
    if (!files || files.length === 0) return;
    const fileList = Array.isArray(files) ? files : [files];
    const prevValues = {};
    fileList.forEach(f => {
      const p = photos.find(item => item.relPath === f) || allProjectPhotos.find(item => item.relPath === f);
      if (p) prevValues[f] = p.triage || null;
    });

    const folderAtStart = currentFolder;
    const filterAtStart = filter;
    const sortAtStart = sort;

    try {
      await setPhotosTriage(fileList, status);
      if (pushToUndo) {
        setUndoStack(prev => [...prev.slice(-30), { type: 'triage', prevValues, newStatus: status, files: fileList }]);
        if (clearRedo) setRedoStack([]);
      }
      const updateTriage = p => {
        if (fileList.includes(p.relPath)) {
          return { ...p, triage: status, isViewed: status ? true : p.isViewed };
        }
        return p;
      };
      setAllProjectPhotos(prev => prev.map(updateTriage));
      updateRetainedPhoto(updateTriage);
      // Recalculate stats with fresh server data
      const refreshed = await fetchPhotos(folderAtStart, filterAtStart, sortAtStart);
      // Drop stale response if user switched folders or filters while async request was in-flight
      if (currentFolderRef.current !== folderAtStart || filterRef.current !== filterAtStart) {
        return;
      }

      if (filterAtStart !== 'all') {
        // If a filter is active (e.g. 'pick', 'maybe', 'reject', 'unassigned'),
        // update photos so photos no longer matching the filter are removed from the view
        setPhotos(refreshed.photos || []);
        const remainingRelPaths = new Set((refreshed.photos || []).map(p => p.relPath));
        setSelectedFiles(prev => prev.filter(f => remainingRelPaths.has(f)));
      } else {
        setPhotos(prev => prev.map(updateTriage));
      }
      setStats({
        totalCount: refreshed.totalCount || 0,
        viewedCount: refreshed.viewedCount || 0,
        favoriteCount: refreshed.favoriteCount || 0,
        pickedCount: refreshed.pickedCount || 0,
        maybeCount: refreshed.maybeCount || 0,
        rejectedCount: refreshed.rejectedCount || 0,
        unassignedPickCount: refreshed.unassignedPickCount || 0,
        notedCount: refreshed.notedCount || 0,
        burstCount: refreshed.burstCount || 0,
      });
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật đánh giá ảnh', 'error');
    }
  };

  // Handle choosing one photo to keep in a duplicate/similar group
  const handleKeepDuplicate = async (keepPath, rejectPaths = [], pushToUndo = true, clearRedo = true) => {
    if (!keepPath) return;
    const otherList = Array.isArray(rejectPaths) ? rejectPaths.filter(p => p && p !== keepPath) : [];
    const allFiles = [keepPath, ...otherList];
    const prevValues = {};
    const nextValues = { [keepPath]: 'pick' };
    otherList.forEach(f => { nextValues[f] = 'reject'; });

    allFiles.forEach(f => {
      const p = photos.find(item => item.relPath === f) || allProjectPhotos.find(item => item.relPath === f);
      prevValues[f] = p ? (p.triage || null) : null;
    });

    const folderAtStart = currentFolderRef.current;
    const filterAtStart = filterRef.current;
    const sortAtStart = sortRef.current;

    try {
      await setPhotosTriage([keepPath], 'pick');
      if (otherList.length > 0) {
        await setPhotosTriage(otherList, 'reject');
      }
      if (pushToUndo) {
        setUndoStack(prev => [...prev.slice(-30), {
          type: 'triage',
          prevValues,
          nextValues,
          newStatus: 'pick',
          files: allFiles,
        }]);
        if (clearRedo) setRedoStack([]);
      }
      const updateGroupTriage = p => {
        if (Object.hasOwn(nextValues, p.relPath)) {
          const st = nextValues[p.relPath];
          return { ...p, triage: st, isViewed: st ? true : p.isViewed };
        }
        return p;
      };
      setAllProjectPhotos(prev => prev.map(updateGroupTriage));
      updateRetainedPhoto(updateGroupTriage);

      const refreshed = await fetchPhotos(folderAtStart, filterAtStart, sortAtStart);
      if (currentFolderRef.current !== folderAtStart || filterRef.current !== filterAtStart) {
        return;
      }
      if (filterAtStart !== 'all') {
        setPhotos(refreshed.photos || []);
        const remainingRelPaths = new Set((refreshed.photos || []).map(p => p.relPath));
        setSelectedFiles(prev => prev.filter(f => remainingRelPaths.has(f)));
      } else {
        setPhotos(prev => prev.map(updateGroupTriage));
      }
      setStats({
        totalCount: refreshed.totalCount || 0,
        viewedCount: refreshed.viewedCount || 0,
        favoriteCount: refreshed.favoriteCount || 0,
        pickedCount: refreshed.pickedCount || 0,
        maybeCount: refreshed.maybeCount || 0,
        rejectedCount: refreshed.rejectedCount || 0,
        unassignedPickCount: refreshed.unassignedPickCount || 0,
        notedCount: refreshed.notedCount || 0,
        burstCount: refreshed.burstCount || 0,
      });
      showToast(`Đã chọn giữ “${keepPath.split('/').pop()}” và bỏ qua ${otherList.length} bản trùng.`);
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật lựa chọn nhóm ảnh trùng', 'error');
    }
  };

  // Handle Virtual Album Tagging (gate, album, table, slide, etc.)
  const handleToggleAlbum = async (albumId, file, inAlbum, pushToUndo = true, clearRedo = true) => {
    try {
      const res = await togglePhotoInAlbum(albumId, file, inAlbum);
      if (pushToUndo) {
        setUndoStack(prev => [...prev.slice(-30), { type: 'album', albumId, file, prevInAlbum: !inAlbum, nextInAlbum: inAlbum }]);
        if (clearRedo) setRedoStack([]);
      }
      const updatePhotoAlbums = (p) => {
        if (p.relPath === file) {
          const currentAlbums = Array.isArray(p.albums) ? p.albums : [];
          const nextAlbums = res.albums !== undefined
            ? res.albums
            : (inAlbum ? Array.from(new Set([...currentAlbums, albumId])) : currentAlbums.filter(id => id !== albumId));
          return { ...p, albums: nextAlbums };
        }
        return p;
      };
      setPhotos(prev => prev.map(updatePhotoAlbums));
      setAllProjectPhotos(prev => prev.map(updatePhotoAlbums));
      updateRetainedPhoto(updatePhotoAlbums);
      setVirtualAlbums(prev => {
        const album = prev[albumId];
        if (!album) return prev;
        const currentPhotos = Array.isArray(album.photos) ? album.photos : [];
        const nextPhotos = inAlbum
          ? (currentPhotos.includes(file) ? currentPhotos : [...currentPhotos, file])
          : currentPhotos.filter(f => f !== file);
        return {
          ...prev,
          [albumId]: {
            ...album,
            photos: nextPhotos,
          }
        };
      });
      if (filter === `album:${albumId}` || filter === 'unassigned') {
        await loadPhotos(currentFolder, filter, sort);
      }
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật album ảo', 'error');
    }
  };

  const applyBatchAlbumMembership = async (albumId, files, inAlbum) => {
    if (batchAlbumBusyRef.current || movePendingRef.current) return null;
    batchAlbumBusyRef.current = true;
    setIsBatchAlbumPending(true);
    try {
      const result = await setAlbumMembership(albumId, files, inAlbum);
      const changed = new Set(result.changedFiles);
      const update = photo => {
        if (!changed.has(photo.relPath)) return photo;
        const albums = (photo.albums || []).filter(id => id !== albumId);
        return { ...photo, albums: inAlbum ? [...albums, albumId] : albums };
      };
      setPhotos(previous => previous.map(update));
      setAllProjectPhotos(previous => previous.map(update));
      updateRetainedPhoto(update);
      setVirtualAlbums(previous => previous[albumId] ? {
        ...previous,
        [albumId]: { ...previous[albumId], photos: result.photos },
      } : previous);
      const currentFilter = filterRef.current;
      if (currentFilter === `album:${albumId}` || currentFilter === 'unassigned') {
        await loadPhotos(currentFolderRef.current, currentFilter, sortRef.current);
      }
      return result.changedFiles;
    } catch (error) {
      showToast(error.message || 'Lỗi khi gắn album cho các ảnh đã chọn.', 'error');
      return null;
    } finally {
      batchAlbumBusyRef.current = false;
      setIsBatchAlbumPending(false);
    }
  };

  const handleAddSelectedToAlbum = async (albumId, files) => {
    const changedFiles = await applyBatchAlbumMembership(albumId, files, true);
    if (!changedFiles) return;
    if (changedFiles.length === 0) {
      showToast('Các ảnh đã chọn đều có trong album.');
      return;
    }
    setUndoStack(previous => [...previous.slice(-30), { type: 'album-batch', albumId, files: changedFiles, inAlbum: true }]);
    setRedoStack([]);
    showToast(`Đã gắn ${changedFiles.length} ảnh vào “${virtualAlbums[albumId]?.name || albumId}”.`);
  };

  const handleRemoveSelectedFromAlbum = async (albumId, files) => {
    const changedFiles = await applyBatchAlbumMembership(albumId, files, false);
    if (!changedFiles) return;
    if (changedFiles.length === 0) {
      showToast('Các ảnh đã chọn không còn trong album này.');
      return;
    }
    setUndoStack(previous => [...previous.slice(-30), { type: 'album-batch', albumId, files: changedFiles, inAlbum: false }]);
    setRedoStack([]);
    showToast(`Đã gỡ ${changedFiles.length} ảnh khỏi “${virtualAlbums[albumId]?.name || albumId}”.`);
  };

  useEffect(() => {
    if (!duplicateModal || !photosDir) return;
    fetchPhotos('', 'all', sortRef.current)
      .then(result => setAllProjectPhotos(result.photos || []))
      .catch(() => {});
  }, [duplicateModal, photosDir]);

  // Handle Update Album Quota (Số lượng cần chọn)
  const handleUpdateQuota = async (albumId, newQuota) => {
    try {
      const res = await updateAlbumQuota(albumId, newQuota);
      setVirtualAlbums(prev => ({
        ...prev,
        [albumId]: {
          ...(prev[albumId] || {}),
          quota: newQuota,
        },
      }));
      showToast(`Đã cập nhật chỉ tiêu cho "${res.album?.name || albumId}" thành ${newQuota} ảnh!`);
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật chỉ tiêu', 'error');
    }
  };

  // Handle Create Custom Virtual Album
  const handleCreateVirtualAlbum = async (id, name, quota) => {
    try {
      const res = await createVirtualAlbum(id, name, quota);
      setVirtualAlbums(prev => ({
        ...prev,
        [res.album.id]: res.album,
      }));
      showToast(`Đã tạo album ảo "${name}" thành công!`);
    } catch (err) {
      showToast(err.message || 'Lỗi khi tạo album mới', 'error');
    }
  };

  // Handle Delete Virtual Album
  const handleDeleteVirtualAlbum = async (albumId) => {
    try {
      await deleteVirtualAlbum(albumId);
      setVirtualAlbums(prev => {
        const next = { ...prev };
        delete next[albumId];
        return next;
      });
      if (filter === `album:${albumId}`) {
        setFilter('all');
      }
      showToast('Đã xoá album ảo thành công');
    } catch (err) {
      showToast(err.message || 'Lỗi khi xoá album ảo', 'error');
    }
  };

  // Undo & Redo Handlers
  const handleUndo = async () => {
    if (undoStack.length === 0 || batchAlbumBusyRef.current) return;
    const action = undoStack[undoStack.length - 1];
    if (action.type === 'album-batch') {
      const targetInAlbum = action.inAlbum === false;
      const changed = await applyBatchAlbumMembership(action.albumId, action.files, targetInAlbum);
      if (!changed) return;
      setUndoStack(previous => previous.filter(entry => entry !== action));
      if (changed.length) setRedoStack(previous => [...previous, { ...action, files: changed }]);
      showToast(targetInAlbum ? `Đã gắn lại ${changed.length} ảnh vào album.` : `Đã gỡ ${changed.length} ảnh khỏi album.`);
      return;
    }
    setUndoStack(prev => prev.slice(0, -1));

    try {
      if (action.type === 'triage') {
        const currentValues = {};
        action.files.forEach(f => {
          const p = photos.find(item => item.relPath === f) || allProjectPhotos.find(item => item.relPath === f);
          if (p) currentValues[f] = p.triage || null;
        });
        setRedoStack(prev => [...prev, {
          type: 'triage',
          prevValues: currentValues,
          nextValues: action.nextValues,
          newStatus: action.newStatus,
          files: action.files,
        }]);
        
        const groups = {};
        Object.entries(action.prevValues).forEach(([file, prevSt]) => {
          const key = prevSt || 'null';
          if (!groups[key]) groups[key] = [];
          groups[key].push(file);
        });
        for (const [stKey, fls] of Object.entries(groups)) {
          await setPhotosTriage(fls, stKey === 'null' ? null : stKey);
        }
        showToast('Đã hoàn tác đánh giá ảnh');
      } else if (action.type === 'album') {
        const prevInAlbum = action.prevInAlbum !== undefined ? action.prevInAlbum : action.wasInAlbum;
        const nextInAlbum = action.nextInAlbum !== undefined ? action.nextInAlbum : !action.wasInAlbum;
        setRedoStack(prev => [...prev, { type: 'album', albumId: action.albumId, file: action.file, prevInAlbum, nextInAlbum }]);
        await handleToggleAlbum(action.albumId, action.file, prevInAlbum, false, false);
        showToast('Đã hoàn tác gắn album');
      } else if (action.type === 'favorite') {
        const prevValue = action.prevValue !== undefined ? action.prevValue : false;
        const nextValue = action.nextValue !== undefined ? action.nextValue : !prevValue;
        setRedoStack(prev => [...prev, { type: 'favorite', relPath: action.relPath, prevValue, nextValue }]);
        await handleToggleFavorite(action.relPath, prevValue, false, false);
        showToast('Đã hoàn tác yêu thích');
      } else if (action.type === 'viewed') {
        const prevValue = action.prevValue !== undefined ? action.prevValue : false;
        const nextValue = action.nextValue !== undefined ? action.nextValue : !prevValue;
        setRedoStack(prev => [...prev, { type: 'viewed', relPath: action.relPath, prevValue, nextValue }]);
        await handleToggleViewed(action.relPath, prevValue, false, false);
        showToast('Đã hoàn tác trạng thái xem');
      } else if (action.type === 'batch-viewed') {
        setRedoStack(prev => [...prev, { type: 'batch-viewed', files: action.files, prevValues: action.prevValues, nextValue: action.nextValue }]);
        for (const [f, prevVal] of Object.entries(action.prevValues)) {
          await markPhotosViewed([f], prevVal);
        }
        showToast('Đã hoàn tác trạng thái xem hàng loạt');
      }
      await loadPhotos(currentFolder, filter, sort);
    } catch (err) {
      showToast('Lỗi khi thực hiện hoàn tác', 'error');
    }
  };

  const handleRedo = async () => {
    if (redoStack.length === 0 || batchAlbumBusyRef.current) return;
    const action = redoStack[redoStack.length - 1];
    if (action.type === 'album-batch') {
      const targetInAlbum = action.inAlbum !== false;
      const changed = await applyBatchAlbumMembership(action.albumId, action.files, targetInAlbum);
      if (!changed) return;
      setRedoStack(previous => previous.filter(entry => entry !== action));
      if (changed.length) setUndoStack(previous => [...previous.slice(-30), { ...action, files: changed }]);
      showToast(targetInAlbum ? `Đã gắn lại ${changed.length} ảnh vào album.` : `Đã gỡ lại ${changed.length} ảnh khỏi album.`);
      return;
    }
    setRedoStack(prev => prev.slice(0, -1));

    try {
      if (action.type === 'triage') {
        if (action.nextValues) {
          const keepEntry = Object.entries(action.nextValues).find(([, st]) => st === 'pick');
          if (keepEntry) {
            const [keepPath] = keepEntry;
            const rejectPaths = Object.entries(action.nextValues)
              .filter(([file, st]) => file !== keepPath && st === 'reject')
              .map(([file]) => file);
            await handleKeepDuplicate(keepPath, rejectPaths, true, false);
          } else {
            await handleSetTriage(action.files, action.newStatus, true, false);
          }
        } else {
          await handleSetTriage(action.files, action.newStatus, true, false);
        }
        showToast('Đã làm lại đánh giá ảnh');
      } else if (action.type === 'album') {
        const targetInAlbum = action.nextInAlbum !== undefined ? action.nextInAlbum : (action.wasInAlbum !== undefined ? action.wasInAlbum : true);
        await handleToggleAlbum(action.albumId, action.file, targetInAlbum, true, false);
        showToast('Đã làm lại gắn album');
      } else if (action.type === 'favorite') {
        const targetValue = action.nextValue !== undefined ? action.nextValue : !action.prevValue;
        await handleToggleFavorite(action.relPath, targetValue, true, false);
        showToast('Đã làm lại yêu thích');
      } else if (action.type === 'viewed') {
        const targetValue = action.nextValue !== undefined ? action.nextValue : !action.prevValue;
        await handleToggleViewed(action.relPath, targetValue, true, false);
        showToast('Đã làm lại trạng thái xem');
      } else if (action.type === 'batch-viewed') {
        await handleBatchViewed(action.files, action.nextValue, true, false);
        showToast('Đã làm lại trạng thái xem hàng loạt');
      }
    } catch (err) {
      showToast('Lỗi khi thực hiện làm lại', 'error');
    }
  };

  useEffect(() => {
    if (activePhotoPath) setGridCursor(activePhotoPath);
  }, [activePhotoPath]);

  useEffect(() => {
    setGridCursor(null);
  }, [currentFolder]);

  // Esc clears the selection when nothing else (viewer, dialog) is open.
  const anyOverlayOpen = Boolean(activePhotoPath) || moveModal.isOpen || rangeModal || compareModal.isOpen ||
    annotationModal.isOpen || createModal.isOpen || renameModal.isOpen || deleteModal.isOpen || settingsModal ||
    stateModal || quotaModalOpen || exportModal || backupModal || duplicateModal || resetViewedModal;
  useEffect(() => {
    if (anyOverlayOpen || selectedFiles.length === 0) return;
    const handleEscape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') return;
      setSelectedFiles([]);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [anyOverlayOpen, selectedFiles.length]);

  // Global Keyboard shortcuts for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    if (exportModal || backupModal || duplicateModal || resetViewedModal) return;
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      if (cmdOrCtrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
      } else if ((cmdOrCtrl && e.key === 'y') || (cmdOrCtrl && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, photos, currentFolder, filter, sort, exportModal, backupModal, duplicateModal, resetViewedModal]);

  // Handle Mark viewed / unviewed
  const handleToggleViewed = async (relPath, viewed, pushToUndo = true, clearRedo = true) => {
    try {
      const result = await markPhotosViewed([relPath], viewed);
      if (pushToUndo && result.changedCount) {
        setUndoStack(prev => [...prev.slice(-30), { type: 'viewed', relPath, prevValue: !viewed, nextValue: viewed }]);
        if (clearRedo) setRedoStack([]);
      }
      updatePhotoMetadata(relPath, viewed ? { isViewed: true } : { isViewed: false, viewedAt: null });
      const folder = currentFolderRef.current;
      const currentFilter = filterRef.current;
      if (result.changedCount && (!folder || getPhotoDirectory(relPath) === folder)) {
        setStats(prev => ({
          ...prev,
          viewedCount: Math.max(0, Math.min(prev.totalCount, prev.viewedCount + (viewed ? 1 : -1))),
        }));
      }
      if (currentFilter === 'viewed' || currentFilter === 'unviewed') {
        await loadPhotos(folder, currentFilter, sortRef.current);
      }
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật trạng thái đã xem.', 'error');
    }
  };

  // Handle Batch viewed
  const handleBatchViewed = async (files, viewed, pushToUndo = true, clearRedo = true) => {
    try {
      const prevValues = {};
      files.forEach(f => {
        const p = photos.find(item => item.relPath === f) || allProjectPhotos.find(item => item.relPath === f);
        if (p) prevValues[f] = !!p.isViewed;
      });

      await markPhotosViewed(files, viewed);
      const targets = new Set(files);
      const update = photo => targets.has(photo.relPath)
        ? { ...photo, isViewed: viewed, ...(viewed ? {} : { viewedAt: null }) }
        : photo;
      setAllProjectPhotos(previous => previous.map(update));
      updateRetainedPhoto(update);
      if (pushToUndo) {
        setUndoStack(prev => [...prev.slice(-30), { type: 'batch-viewed', files, prevValues, nextValue: viewed }]);
        if (clearRedo) setRedoStack([]);
      }
      showToast(`Đã đánh dấu ${files.length} ảnh là ${viewed ? 'Đã xem' : 'Chưa xem'}`);
      await loadPhotos();
    } catch (err) {
      showToast('Lỗi khi cập nhật trạng thái', 'error');
    }
  };

  const handleResetViewed = async () => {
    if (isResettingViewed || !config?.collectionId) return;
    setIsResettingViewed(true);
    setResetViewedError('');
    try {
      const { count } = await resetViewedPhotos(config.collectionId);
      const clearViewed = photo => photo.isViewed || photo.viewedAt
        ? { ...photo, isViewed: false, viewedAt: null }
        : photo;
      setPhotos(previous => filterRef.current === 'viewed' ? [] : previous.map(clearViewed));
      setAllProjectPhotos(previous => previous.map(clearViewed));
      updateRetainedPhoto(clearViewed);
      setStats(previous => ({ ...previous, viewedCount: 0 }));
      if (count) {
        const keepOtherActions = stack => stack.filter(action => action.type !== 'viewed' && action.type !== 'batch-viewed');
        setUndoStack(keepOtherActions);
        setRedoStack(keepOtherActions);
      }
      await loadPhotos(currentFolderRef.current, filterRef.current, sortRef.current);
      setResetViewedModal(false);
      showToast(count ? `Đã đưa ${count} ảnh về trạng thái chưa xem.` : 'Bộ ảnh này hiện chưa có ảnh đã xem.');
    } catch (error) {
      setResetViewedError(error.message || 'Lỗi khi đặt lại trạng thái đã xem.');
    } finally {
      setIsResettingViewed(false);
    }
  };

  // Handle Toggle favorite
  const handleToggleFavorite = async (relPath, favorite, pushToUndo = true, clearRedo = true) => {
    try {
      const currentPhoto = photos.find(p => p.relPath === relPath) || allProjectPhotos.find(p => p.relPath === relPath);
      const prevValue = currentPhoto ? !!currentPhoto.isFavorite : !favorite;

      await toggleFavorite(relPath, favorite);
      if (pushToUndo) {
        setUndoStack(prev => [...prev.slice(-30), { type: 'favorite', relPath, prevValue, nextValue: favorite }]);
        if (clearRedo) setRedoStack([]);
      }
      updatePhotoMetadata(relPath, { isFavorite: favorite });
      setStats(prev => ({
        ...prev,
        favoriteCount: favorite ? prev.favoriteCount + 1 : Math.max(0, prev.favoriteCount - 1),
      }));
      if (filter === 'favorite') {
        await loadPhotos(currentFolder, filter, sort);
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  // Handle Save Note
  const handleSaveNote = async (relPath, note) => {
    try {
      await saveNote(relPath, note);
      updatePhotoMetadata(relPath, { note });
      showToast('Đã lưu ghi chú ảnh!');
    } catch (err) {
      showToast('Lỗi khi lưu ghi chú', 'error');
    }
  };

  // Handle Update Settings (Local directory path)
  const handleSaveSettings = async (newDir) => {
    if (movePendingRef.current || batchAlbumBusyRef.current) {
      showToast('Đợi thao tác trên ảnh hoàn tất trước khi đổi thư mục.', 'error');
      return;
    }
    try {
      await sessionWriteRef.current;
      const res = await updateConfig(newDir);
      if (res.config.photosDir !== photosDir) {
        loadRequestIdRef.current += 1;
        compareRequestIdRef.current += 1;
        restoredCollectionRef.current = null;
        setRestoredCollection(null);
        setCurrentFolder('');
        setFilter('all');
        setSort('name-asc');
        setSearchQuery('');
        setActivePhotoPath(null);
        setRetainedPhoto(null);
        setReviewCheckpoint(null);
        setResumeRequest(null);
        setSelectedFiles([]);
        setMoveNotice(null);
        setUndoStack([]);
        setRedoStack([]);
        setPhotos([]);
        setAllProjectPhotos([]);
      }
      setConfig({ ...res.config, collectionId: res.collectionId });
      setSettingsModal(false);
      showToast('Đã cập nhật thư mục ảnh thành công!');
      await refreshTree();
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật thư mục', 'error');
    }
  };

  // Handle View Raw JSON state
  const handleOpenStateModal = async () => {
    try {
      const state = await fetchViewedState();
      setRawStateData(state);
      setStateModal(true);
    } catch (err) {
      showToast('Lỗi khi đọc file viewed_state.json', 'error');
    }
  };

  const handleOpenBackup = async () => {
    if (!config?.collectionId || movePendingRef.current || batchAlbumBusyRef.current) return;
    await sessionWriteRef.current;
    setBackupModal(true);
  };

  const handleRestoredBackup = async ({ session, summary }) => {
    if (summary.changes === 0) return;
    discardPendingReviewSession(photosDir);
    sessionVersionRef.current = Math.max(sessionVersionRef.current, session?.clientUpdatedAt || 0);
    setReviewCheckpoint(readReviewCheckpoint(session?.reviewCheckpoint) || readReviewCheckpoint({
      photoPath: session?.lastActivePhoto,
      folder: session?.activeFolder,
      filter: session?.activeFilter,
      sort: session?.activeSort,
      searchQuery: session?.activeSearchQuery,
    }));
    setResumeRequest(null);
    setActivePhotoPath(null);
    setRetainedPhoto(null);
    setUndoStack([]);
    setRedoStack([]);
    const folder = currentFolderRef.current;
    const currentFilter = filterRef.current;
    const currentSort = sortRef.current;
    await loadPhotos(folder, currentFilter, currentSort);
    if (folder || currentFilter !== 'all') {
      try {
        const result = await fetchPhotos('', 'all', currentSort);
        setAllProjectPhotos(result.photos || []);
      } catch {
        setAllProjectPhotos([]);
      }
    }
  };

  // Handle Generate sample photos
  const handleGenerateSamples = async () => {
    try {
      await generateSamplePhotos();
      showToast('Đã tạo các ảnh mẫu và thư mục thử nghiệm thành công!');
      await refreshTree();
      await loadPhotos();
    } catch (err) {
      showToast(err.message || 'Lỗi khi tạo ảnh mẫu', 'error');
    }
  };

  // Selection handlers
  const handleToggleSelect = (relPath, extendRange = false) => {
    const anchor = selectionAnchorRef.current;
    if (!extendRange || !displayedPhotos.some(photo => photo.relPath === anchor)) {
      selectionAnchorRef.current = relPath;
    }
    setSelectedFiles(previous => {
      if (extendRange) {
        const range = addPhotoSelectionRange(previous, displayedPhotos, anchor, relPath);
        if (range) return range;
      }
      return previous.includes(relPath)
        ? previous.filter(path => path !== relPath)
        : [...previous, relPath];
    });
  };

  const handleSelectAll = (fileList = displayedPhotos.map(p => p.relPath)) => {
    selectionAnchorRef.current = null;
    setSelectedFiles(fileList);
  };

  const handleDeselectAll = () => {
    selectionAnchorRef.current = null;
    setSelectedFiles([]);
  };

  const handleOpenCompare = async (photoA, photoB, fromViewer = false) => {
    const requestId = ++compareRequestIdRef.current;
    const basePhotoA = photoA || displayedPhotos[0] || photos[0] || allProjectPhotos[0] || null;
    if (!basePhotoA) return;

    const targetFolder = resolveComparisonFolder({
      currentFolder,
      photoA: basePhotoA,
      photoB,
      selectedFiles,
    });
    const candidatePool = buildComparisonCandidatePool({
      allPhotos: [...displayedPhotos, ...photos],
      burstPhotos: allProjectPhotos,
      photoA: basePhotoA,
      photoB,
      selectedFiles,
      currentFolder,
    });
    const resolvedInitial = resolveComparisonPair(candidatePool, basePhotoA, photoB, {
      folder: targetFolder,
      currentFolder,
      selectedFiles,
    });

    const openPair = (otherPhoto, firstPhoto = basePhotoA) => {
      if (fromViewer) setActivePhotoPath(null);
      setCompareModal({ isOpen: true, photoA: firstPhoto, photoB: otherPhoto });
    };

    const burstPaths = basePhotoA.burstPhotos;
    if (photoB) {
      openPair(photoB, basePhotoA);
    } else if (!burstPaths?.length && resolvedInitial.photoB) {
      openPair(resolvedInitial.photoB, resolvedInitial.photoA || basePhotoA);
      return;
    }

    const needsBurstFetch = Boolean(
      burstPaths?.length && (!photoB || burstPaths.includes(photoB.relPath)),
    );
    const needsAllPhotosAtRoot = !currentFolder && allProjectPhotos.length === 0;
    const knownPaths = new Set([...photos, ...allProjectPhotos].map(photo => photo.relPath));
    if (
      photoB
      && !needsAllPhotosAtRoot
      && (!needsBurstFetch || burstPaths.every(path => knownPaths.has(path)))
    ) {
      return;
    }

    try {
      const result = await fetchPhotos('', 'all', sort);
      if (requestId !== compareRequestIdRef.current) return;
      const freshPhotos = result.photos || [];
      setAllProjectPhotos(freshPhotos);
      if (!photoB) {
        const neighbor = burstPaths?.length ? findBurstNeighbor(basePhotoA, photos, freshPhotos) : null;
        if (neighbor && (targetFolder === null || getPhotoDirectory(neighbor) === targetFolder)) {
          openPair(neighbor, basePhotoA);
          return;
        }
        const freshPool = buildComparisonCandidatePool({
          allPhotos: [...displayedPhotos, ...photos],
          burstPhotos: freshPhotos,
          photoA: basePhotoA,
          photoB: null,
          selectedFiles,
          currentFolder,
        });
        const fallback = resolveComparisonPair(freshPool, basePhotoA, null, {
          folder: targetFolder,
          currentFolder,
          selectedFiles,
        });
        if (fallback.photoB) {
          openPair(fallback.photoB, fallback.photoA || basePhotoA);
        } else {
          showToast('Không có ảnh khác trong cùng thư mục để so sánh.', 'error');
        }
      }
    } catch {
      if (!photoB && requestId === compareRequestIdRef.current) {
        if (resolvedInitial.photoB) {
          openPair(resolvedInitial.photoB, resolvedInitial.photoA || basePhotoA);
        } else {
          showToast('Không thể tải ảnh trong cùng thư mục để so sánh.', 'error');
        }
      }
    }
  };

  const handleChangeActivePhoto = (relPath) => {
    compareRequestIdRef.current += 1;
    setResumeRequest(null);
    const index = relPath ? displayedPhotos.findIndex(photo => photo.relPath === relPath) : -1;
    setRetainedPhoto(index < 0 ? null : { photo: displayedPhotos[index], index });
    if (relPath) {
      const photoIndex = Math.max(0, index);
      const newPosition = activePhotoPath ? null : captureReviewScroll(galleryScrollRef.current, relPath);
      setReviewCheckpoint(previous => ({
        ...(newPosition || previous),
        folder: currentFolder,
        filter,
        sort,
        searchQuery,
        photoPath: relPath,
        photoIndex,
      }));
    }
    setActivePhotoPath(relPath);
  };

  const handleCloseCompare = () => {
    compareRequestIdRef.current += 1;
    setCompareModal({ isOpen: false, photoA: null, photoB: null });
  };

  // Mouse / browser "Back" closes the photo viewer or compare view instead of leaving the app.
  useBackToClose(Boolean(activePhotoPath), () => handleChangeActivePhoto(null));
  useBackToClose(compareModal.isOpen, handleCloseCompare);

  const exportPhotos = packageSnapshot?.photos ?? allProjectPhotos;
  const libraryCovered = exportModal || backupModal || duplicateModal || resetViewedModal;

  return (
    <div className="studio flex h-dvh flex-col overflow-hidden font-sans text-slate-100">
      {!libraryCovered && (toast || moveNotice) && (
        <div className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-sm">
          {toast && (
            <div role="status" className={`pointer-events-auto rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-2xl ${
              toast.type === 'error'
                ? 'border-rose-700 bg-rose-950 text-rose-200'
                : 'border-emerald-500/50 bg-slate-900 text-emerald-300'
            }`}>
              {toast.message}
            </div>
          )}
          {moveNotice && (
            <div className="pointer-events-auto w-full rounded-xl border border-studio-line bg-[var(--studio-panel)] p-3 text-xs shadow-2xl">
              <div className="flex items-center gap-2">
                <p role="status" className="min-w-0 flex-1 break-words text-stone-100">{moveNotice.message}</p>
                <button type="button" onClick={() => setMoveNotice(null)} disabled={movePending} className="studio-icon !h-7 !w-7" aria-label="Đóng thông báo chuyển ảnh">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {moveNotice.failures.length > 0 && (
                <details className="mt-1 text-amber-200">
                  <summary className="cursor-pointer">Chi tiết ({moveNotice.failures.length} ảnh)</summary>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-auto break-words">
                    {moveNotice.failures.map((item, index) => (
                      <li key={index}>{item.oldPath}: {item.error || item.warning}</li>
                    ))}
                  </ul>
                </details>
              )}
              {moveNotice.undoToken && (
                <button
                  type="button"
                  onClick={handleUndoMove}
                  disabled={movePending}
                  className="studio-primary mt-2"
                >
                  {movePending ? 'Đang xử lý…' : 'Hoàn tác chuyển ảnh'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <Header
        isInactive={libraryCovered}
        sidebarOpen={sidebarOpen}
        sidebarToggleRef={sidebarToggleRef}
        onToggleSidebar={() => setSidebarOpen(open => !open)}
        canUndo={undoStack.length > 0 && !isBatchAlbumPending}
        canRedo={redoStack.length > 0 && !isBatchAlbumPending}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenSettings={() => setSettingsModal(true)}
        onOpenStateModal={handleOpenStateModal}
        onOpenDuplicates={photosDir ? () => setDuplicateModal(true) : undefined}
        onOpenBackup={config?.collectionId ? handleOpenBackup : undefined}
        onOpenResetViewed={config?.collectionId ? () => {
          setResetViewedError('');
          setResetViewedModal(true);
        } : undefined}
        onOpenExportModal={handleOpenExport}
      />

      {/* Main Body: Sidebar + Gallery */}
      <div inert={libraryCovered ? '' : undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <Sidebar
          tree={tree}
          currentFolder={currentFolder}
          onSelectFolder={handleSelectSidebarFolder}
          onCreateSubfolder={(parentPath, parentName) => {
            setCreateModal({ isOpen: true, parentPath, parentName });
          }}
          onRenameFolder={(folderPath, currentName) => {
            setRenameModal({ isOpen: true, folderPath, currentName });
          }}
          onDeleteFolder={(folderPath, name) => {
            setDeleteModal({ isOpen: true, folderPath, name });
          }}
          onDropPhotos={handleMovePhotos}
          isOpen={sidebarOpen}
          virtualAlbums={virtualAlbums}
          filter={filter}
          onChangeFilter={value => {
            setResumeRequest(null);
            setFilter(value);
            if (sidebarOpen) setSidebarOpen(false);
          }}
          onOpenQuotaModal={() => setQuotaModalOpen(true)}
          onDropPhotosToAlbum={handleAddSelectedToAlbum}
        />

        <Gallery
          scrollContainerRef={galleryScrollRef}
          resumeAction={restoredCollection === photosDir && reviewCheckpoint && (
            <button
              type="button"
              onClick={handleResumeReview}
              disabled={Boolean(resumeRequest)}
              className="gallery-control"
              title={reviewCheckpoint.photoPath}
            >
              <Play className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
              {resumeRequest ? 'Đang mở ảnh…' : 'Duyệt tiếp'}
            </button>
          )}
          currentFolder={currentFolder}
          onSelectFolder={handleSelectFolder}
          onOpenSettings={() => setSettingsModal(true)}
          onGenerateSamples={handleGenerateSamples}
          isLoading={isLoadingPhotos}
          photos={photos}
          collectionPhotos={allProjectPhotos}
          displayedPhotos={displayedPhotos}
          totalCount={stats.totalCount}
          viewedCount={stats.viewedCount}
          favoriteCount={stats.favoriteCount}
          pickedCount={stats.pickedCount}
          maybeCount={stats.maybeCount}
          rejectedCount={stats.rejectedCount}
          unassignedPickCount={stats.unassignedPickCount}
          notedCount={stats.notedCount}
          burstCount={stats.burstCount}
          filter={filter}
          onChangeFilter={value => { setResumeRequest(null); setFilter(value); }}
          sort={sort}
          onChangeSort={value => { setResumeRequest(null); setSort(value); }}
          searchQuery={searchQuery}
          onChangeSearch={value => { setResumeRequest(null); setSearchQuery(value); }}
          selectedFiles={selectedFiles}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          cursorPath={gridCursor}
          onCursorChange={setGridCursor}
          keyboardEnabled={!anyOverlayOpen && !libraryCovered}
          onDeselectAll={handleDeselectAll}
          onOpenLightbox={handleChangeActivePhoto}
          onToggleViewed={handleToggleViewed}
          onToggleFavorite={handleToggleFavorite}
          onBatchViewed={handleBatchViewed}
          onAddSelectedToAlbum={handleAddSelectedToAlbum}
          onRemoveSelectedFromAlbum={handleRemoveSelectedFromAlbum}
          isBatchAlbumPending={isBatchAlbumPending || movePending}
          onSetTriage={handleSetTriage}
          virtualAlbums={virtualAlbums}
          onOpenMoveModal={(files) => setMoveModal({ isOpen: true, files })}
          onOpenRangeGroup={() => setRangeModal(true)}
          onOpenCompare={handleOpenCompare}
          onOpenExportModal={handleOpenExport}
          onOpenQuotaModal={() => setQuotaModalOpen(true)}
        />
      </div>

      {/* Fullscreen Lightbox - Operates on currently displayed/filtered photos list */}
      {activePhotoPath && (
        <Lightbox
          photos={displayedPhotos}
          retainedPhoto={retainedPhoto?.photo}
          retainedPhotoIndex={retainedPhoto?.index}
          collectionPhotos={allProjectPhotos}
          activePhotoPath={activePhotoPath}
          onClose={() => handleChangeActivePhoto(null)}
          onChangeActivePhoto={handleChangeActivePhoto}
          onToggleViewed={handleToggleViewed}
          onToggleFavorite={handleToggleFavorite}
          onSaveNote={handleSaveNote}
          onOpenMoveModal={(files) => setMoveModal({ isOpen: true, files })}
          folders={flatFolders}
          onMovePhotos={handleMovePhotos}
          isMoving={movePending}
          onOpenAnnotation={(photo) => setAnnotationModal({ isOpen: true, photo })}
          onSetTriage={handleSetTriage}
          virtualAlbums={virtualAlbums}
          onToggleAlbum={handleToggleAlbum}
          onUndo={handleUndo}
          canUndo={undoStack.length > 0}
          isCovered={moveModal.isOpen || annotationModal.isOpen}
          onOpenCompare={(pA, pB) => handleOpenCompare(pA, pB, true)}
        />
      )}

      {/* Modals */}
      <CreateFolderModal
        isOpen={createModal.isOpen}
        onClose={() => setCreateModal({ isOpen: false, parentPath: '', parentName: '' })}
        onSubmit={handleCreateSubfolder}
        parentPath={createModal.parentPath}
        parentName={createModal.parentName}
      />

      <RenameFolderModal
        isOpen={renameModal.isOpen}
        onClose={() => setRenameModal({ isOpen: false, folderPath: '', currentName: '' })}
        onSubmit={handleRenameFolder}
        folderPath={renameModal.folderPath}
        currentName={renameModal.currentName}
      />

      <DeleteFolderModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, folderPath: '', name: '' })}
        onConfirm={handleDeleteFolder}
        folderPath={deleteModal.folderPath}
        name={deleteModal.name}
      />

      <MoveModal
        isOpen={moveModal.isOpen}
        onClose={() => setMoveModal({ isOpen: false, files: [] })}
        onConfirm={handleMovePhotos}
        isMoving={movePending}
        files={moveModal.files}
        folders={flatFolders}
      />

      <RangeGroupModal
        isOpen={rangeModal}
        onClose={() => setRangeModal(false)}
        onConfirm={handleGroupRange}
        onSelect={handleSelectRange}
        isMoving={movePending}
        photos={displayedPhotos}
        folders={flatFolders}
        currentFolder={currentFolder}
      />

      <SettingsModal
        isOpen={settingsModal}
        onClose={() => setSettingsModal(false)}
        currentPath={config?.photosDir}
        onSave={handleSaveSettings}
      />

      <StateViewModal
        isOpen={stateModal}
        onClose={() => setStateModal(false)}
        stateData={rawStateData}
        onRefresh={handleOpenStateModal}
      />

      {resetViewedModal && (
        <DialogShell
          title="Đặt lại trạng thái đã xem"
          icon={EyeOff}
          size="sm"
          onClose={() => { if (!isResettingViewed) setResetViewedModal(false); }}
          footer={(
            <>
              <button type="button" data-autofocus className="gallery-control" disabled={isResettingViewed} onClick={() => setResetViewedModal(false)}>
                Hủy
              </button>
              <button type="button" className="studio-primary" disabled={isResettingViewed} onClick={handleResetViewed}>
                {isResettingViewed ? 'Đang đặt lại…' : 'Đặt tất cả thành chưa xem'}
              </button>
            </>
          )}
        >
          <p className="text-sm leading-relaxed text-stone-300">
            Tất cả ảnh trong bộ ảnh đang mở, kể cả trong thư mục con, sẽ về trạng thái Chưa xem.
          </p>
          {resetViewedError && <p role="alert" className="mt-3 text-xs text-rose-300">{resetViewedError}</p>}
        </DialogShell>
      )}

      <DuplicatePhotosModal
        isOpen={duplicateModal}
        isCovered={compareModal.isOpen}
        onClose={() => setDuplicateModal(false)}
        photos={allProjectPhotos.length ? allProjectPhotos : photos}
        onSetTriage={handleSetTriage}
        onKeepDuplicate={handleKeepDuplicate}
        onCompare={(photoA, photoB) => {
          const sourcePhotos = allProjectPhotos.length ? allProjectPhotos : photos;
          const lookup = new Map(sourcePhotos.map(photo => [photo.relPath, photo]));
          handleOpenCompare(lookup.get(photoA.relPath) || photoA, lookup.get(photoB.relPath) || photoB);
        }}
      />

      <CollectionBackupModal
        isOpen={backupModal}
        collectionId={config?.collectionId}
        onClose={() => setBackupModal(false)}
        onRestored={handleRestoredBackup}
      />

      <CompareModal
        isOpen={compareModal.isOpen}
        onClose={handleCloseCompare}
        photoA={compareModal.photoA}
        photoB={compareModal.photoB}
        currentFolder={currentFolder}
        allPhotos={duplicateModal ? allProjectPhotos : photos}
        burstPhotos={allProjectPhotos}
        selectedFiles={selectedFiles}
        onToggleSelect={handleToggleSelect}
        onKeepDuplicate={handleKeepDuplicate}
        onToggleFavorite={handleToggleFavorite}
        onToggleViewed={handleToggleViewed}
        onSaveNote={handleSaveNote}
        onMovePhoto={handleMovePhotos}
        onSetTriage={handleSetTriage}
        virtualAlbums={virtualAlbums}
        onToggleAlbum={handleToggleAlbum}
      />

      <ExportModal
        isOpen={exportModal}
        onClose={handleCloseExport}
        allPhotos={exportPhotos}
        isLoadingPackagePhotos={isLoadingPackagePhotos}
        packagePhotosError={packagePhotosError}
        onRetryPackagePhotos={loadPackagePhotos}
        selectedPhotos={selectedPhotoObjects}
        favoritePhotos={exportPhotos.filter(p => p.isFavorite)}
        viewedPhotos={exportPhotos.filter(p => p.isViewed)}
        virtualAlbums={packageSnapshot?.albums ?? virtualAlbums}
        onSuccessToast={showToast}
        onRefreshTree={refreshTree}
      />

      <AnnotationModal
        isOpen={annotationModal.isOpen}
        onClose={() => setAnnotationModal({ isOpen: false, photo: null })}
        photo={annotationModal.photo}
        onSuccessToast={showToast}
        onUpdatePhotoAnnotations={(relPath, annotations) => {
          updatePhotoMetadata(relPath, { annotations });
        }}
      />

      <QuotaModal
        isOpen={quotaModalOpen}
        onClose={() => setQuotaModalOpen(false)}
        virtualAlbums={virtualAlbums}
        onUpdateQuota={handleUpdateQuota}
        onCreateAlbum={handleCreateVirtualAlbum}
        onDeleteAlbum={handleDeleteVirtualAlbum}
        onSuccessToast={showToast}
      />
    </div>
  );
}
