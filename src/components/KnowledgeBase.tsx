'use client';

import { useState, useEffect, ChangeEvent, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';
import * as mime from 'mime-types';

/* ------------ Config ------------ */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ['txt', 'pdf', 'docx'];
const ALLOWED_MIME_TYPES = [
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/* ------------ Types ------------ */
type UserFile = {
  id: number;
  filename: string;
  status: 'uploaded' | 'processing' | 'processed' | 'failed';
  upload_timestamp: string;
};

type FileStatusUpdate = {
  file_id: number;
  status: UserFile['status'];
  error_message: string | null;
};

/* ------------ Utils ------------ */
const validateFile = (file: File | null): { isValid: boolean; message: string } => {
  if (!file) return { isValid: false, message: 'No file selected.' };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { isValid: false, message: `File is too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.` };
  }
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { isValid: false, message: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }
  const mimeType = mime.lookup(file.name) || file.type;
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { isValid: false, message: 'Invalid file type. Please upload a valid document.' };
  }
  return { isValid: true, message: 'File is valid.' };
};

const statusBadge = (s: UserFile['status']) => {
  const base = 'px-2 py-0.5 text-[11px] rounded-full border';
  switch (s) {
    case 'processed':
      return `${base} bg-emerald-500/15 text-emerald-200 border-emerald-500/30`;
    case 'processing':
      return `${base} bg-amber-500/15 text-amber-200 border-amber-500/30`;
    case 'failed':
      return `${base} bg-rose-500/15 text-rose-200 border-rose-500/30`;
    default:
      return `${base} bg-gray-500/10 text-gray-300 border-gray-500/30`;
  }
};

export default function KnowledgeBase() {
  const { authToken } = useAppContext();

  const [files, setFiles] = useState<UserFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Drag & drop state (purely visual)
  const [dragOver, setDragOver] = useState(false);

  /* ------------ Initial fetch + SSE stream ------------ */
  useEffect(() => {
    if (!authToken) return;

    const fetchFiles = async () => {
      try {
        const response = await fetch(`${API_URL}/files`, {
          headers: { Authorization: `Bearer ${authToken}` },
          credentials: 'include',
        });
        if (response.ok) {
          const fetchedFiles: UserFile[] = await response.json();
          fetchedFiles.sort(
            (a, b) => new Date(b.upload_timestamp).getTime() - new Date(a.upload_timestamp).getTime(),
          );
          setFiles(fetchedFiles);
        }
      } catch (error) {
        console.error('Failed to fetch files:', error);
      }
    };
    fetchFiles();

    // IMPORTANT: encode token to avoid parsing issues, accept both token & access_token on backend
    const tokenParam = encodeURIComponent(authToken);
    const es = new EventSource(`${API_URL}/files/status-stream?token=${tokenParam}`);

    es.addEventListener('open', () => {
      console.log('SSE connection established.');
    });

    es.addEventListener('status_update', (event) => {
      try {
        const data: FileStatusUpdate = JSON.parse((event as MessageEvent).data);
        setFiles((prev) =>
          prev.map((file) => (file.id === data.file_id ? { ...file, status: data.status } : file)),
        );
      } catch (err) {
        console.error('Failed to parse SSE data:', (event as MessageEvent).data);
      }
    });

    es.addEventListener('ping', () => {
      // no-op heartbeat
    });

    es.addEventListener('error', (error) => {
      // 401s appear here too; let EventSource auto-retry
      console.error('SSE error:', error);
    });

    return () => {
      es.close();
    };
  }, [authToken]);

  /* ------------ Handlers ------------ */
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files ? event.target.files[0] : null;
    const { isValid, message } = validateFile(file);
    if (!isValid) {
      setUploadStatus(message);
      setSelectedFile(null);
      event.target.value = '';
      return;
    }
    setSelectedFile(file);
    setUploadStatus('');
  };

  const handleUpload = () => {
    if (!selectedFile || !authToken) return;

    const formData = new FormData();
    formData.append('file', selectedFile);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded * 100) / event.total));
      }
    });

    xhr.addEventListener('load', () => {
      setIsUploading(false);
      setUploadProgress(100);

      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadStatus(`'${selectedFile.name}' uploaded. Processing…`);
        // ensure it appears immediately
        (async () => {
          try {
            const response = await fetch(`${API_URL}/files`, {
              headers: { Authorization: `Bearer ${authToken}` },
              credentials: 'include',
            });
            if (response.ok) {
              const fetched: UserFile[] = await response.json();
              fetched.sort(
                (a, b) => new Date(b.upload_timestamp).getTime() - new Date(a.upload_timestamp).getTime(),
              );
              setFiles(fetched);
            }
          } catch (e) {
            console.error('Fetch after upload failed:', e);
          }
        })();
      } else {
        try {
          const errorResponse = JSON.parse(xhr.responseText);
          setUploadStatus(`Upload failed: ${errorResponse.detail || xhr.statusText}`);
        } catch {
          setUploadStatus(`Upload failed with status: ${xhr.status}`);
        }
      }

      setSelectedFile(null);
      const input = document.getElementById('file-input') as HTMLInputElement | null;
      if (input) input.value = '';
    });

    xhr.addEventListener('error', () => {
      setIsUploading(false);
      setUploadStatus('An error occurred during the upload. Please try again.');
    });

    xhr.addEventListener('abort', () => {
      setIsUploading(false);
      setUploadStatus('Upload cancelled.');
    });

    xhr.open('POST', `${API_URL}/files/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus(`Uploading ${selectedFile.name}…`);
    xhr.send(formData);
  };

  const handleCancelUpload = () => {
    try {
      xhrRef.current?.abort();
    } catch {}
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    const { isValid, message } = validateFile(file);
    if (!isValid) {
      setUploadStatus(message);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setUploadStatus('');
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  /* ------------ Render ------------ */
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-2xl font-bold text-transparent">
            Knowledge Base
          </h1>
          <span className="text-xs text-gray-400">Max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB • txt, pdf, docx</span>
        </div>

        {/* Upload card */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-white/90">Upload Document</h2>

          {/* Drag & drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition ${
              dragOver
                ? 'border-cyan-400/60 bg-cyan-400/5'
                : 'border-white/15 hover:border-white/25 hover:bg-white/5'
            }`}
          >
            <input
              id="file-input"
              type="file"
              onChange={handleFileChange}
              className="hidden"
              accept={ALLOWED_EXTENSIONS.map((e) => '.' + e).join(',')}
            />
            <button
              onClick={() => document.getElementById('file-input')?.click()}
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white/90 hover:bg-white/20"
            >
              Choose file
            </button>
            <div className="mt-2 text-xs text-gray-400">or drag & drop your file here</div>

            {selectedFile && !isUploading && (
              <div className="mt-3 text-sm text-gray-300">
                Selected: <span className="font-medium text-white">{selectedFile.name}</span>
              </div>
            )}

            {/* Upload actions & progress */}
            {!isUploading ? (
              <div className="mt-4">
                <button
                  onClick={handleUpload}
                  disabled={!selectedFile}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2 text-sm font-medium text-black shadow hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Upload
                </button>
              </div>
            ) : (
              <div className="mt-4 w-full max-w-lg">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm text-gray-300">{selectedFile?.name}</span>
                  <span className="text-sm text-gray-300">{uploadProgress}%</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-white/10">
                  <div
                    className="h-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <button onClick={handleCancelUpload} className="mt-2 text-sm text-rose-300 hover:text-rose-200">
                  Cancel
                </button>
              </div>
            )}

            {uploadStatus && !isUploading && <div className="mt-3 text-xs text-gray-300">{uploadStatus}</div>}
          </div>
        </div>

        {/* Files list */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white/90">Your Documents</h2>
            <span className="text-xs text-gray-400">
              {files.length} file{files.length === 1 ? '' : 's'}
            </span>
          </div>

          {files.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-gray-300">
              No documents uploaded yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {files.map((file) => {
                const ext = file.filename.split('.').pop()?.toUpperCase();
                return (
                  <div
                    key={file.id}
                    className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-4"
                    title={file.filename}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{file.filename}</div>
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          Uploaded {new Date(file.upload_timestamp).toLocaleString()}
                        </div>
                      </div>
                      <span className={statusBadge(file.status)}>{file.status}</span>
                    </div>
                    {ext && <div className="text-[10px] text-gray-400">.{ext.toLowerCase()}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
