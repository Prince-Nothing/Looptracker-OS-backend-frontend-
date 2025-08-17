'use client';

import { useState, useEffect, ChangeEvent, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';
import * as mime from 'mime-types';

// --- Configuration for File Validation ---
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ['txt', 'pdf', 'docx'];
const ALLOWED_MIME_TYPES = [
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

// --- Type Definitions ---
type UserFile = {
    id: number;
    filename: string;
    status: "uploaded" | "processing" | "processed" | "failed";
    upload_timestamp: string;
};

// NEW: Type for the SSE message payload
type FileStatusUpdate = {
    file_id: number;
    status: UserFile['status'];
    error_message: string | null;
};

// --- Validation Function ---
const validateFile = (file: File | null): { isValid: boolean, message: string } => {
    if (!file) {
        return { isValid: false, message: 'No file selected.' };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
        return { isValid: false, message: `File is too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.` };
    }
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return { isValid: false, message: `Invalid file extension. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}` };
    }
    const mimeType = mime.lookup(file.name) || file.type;
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return { isValid: false, message: 'Invalid file type. Please upload a valid document.' };
    }
    return { isValid: true, message: 'File is valid.' };
};


export default function KnowledgeBase() {
    const { authToken } = useAppContext();
    const [files, setFiles] = useState<UserFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadStatus, setUploadStatus] = useState('');
    
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const xhrRef = useRef<XMLHttpRequest | null>(null);

    // --- MODIFIED: useEffect now sets up the real-time SSE listener and removes polling ---
    useEffect(() => {
        if (!authToken) return;

        // 1. Fetch the initial list of files when the component mounts
        const fetchFiles = async () => {
            try {
                const response = await fetch(`${API_URL}/files`, {
                    headers: { 'Authorization': `Bearer ${authToken}` },
                });
                if (response.ok) {
                    const fetchedFiles: UserFile[] = await response.json();
                    fetchedFiles.sort((a, b) => new Date(b.upload_timestamp).getTime() - new Date(a.upload_timestamp).getTime());
                    setFiles(fetchedFiles);
                }
            } catch (error) {
                console.error("Failed to fetch files:", error);
            }
        };
        fetchFiles();

        // 2. Set up the Server-Sent Events listener
        const eventSource = new EventSource(`${API_URL}/files/status-stream?token=${authToken}`);

        eventSource.onopen = () => {
            console.log("SSE Connection established.");
        };

        // This listener handles our custom 'status_update' events from the server
        eventSource.addEventListener('status_update', (event) => {
            try {
                const data: FileStatusUpdate = JSON.parse(event.data);
                
                setFiles(prevFiles => 
                    prevFiles.map(file => 
                        file.id === data.file_id 
                            ? { ...file, status: data.status } 
                            : file
                    )
                );
            } catch (error) {
                console.error("Failed to parse SSE data:", event.data);
            }
        });

        eventSource.onerror = (error) => {
            console.error("SSE Error:", error);
            eventSource.close();
        };

        // 3. Clean up the connection when the component unmounts
        return () => {
            console.log("Closing SSE connection.");
            eventSource.close();
        };
    }, [authToken]); // Rerun effect if authToken changes

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        const validationResult = validateFile(file);
        if (!validationResult.isValid) {
            setUploadStatus(validationResult.message);
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
                 setUploadStatus(`File '${selectedFile.name}' uploaded. Awaiting processing...`);
                 // The SSE stream will handle updates from here, but we can fetch once
                 // to ensure the newly uploaded file appears in the list immediately.
                 const fetchFilesAfterUpload = async () => {
                    try {
                        const response = await fetch(`${API_URL}/files`, { headers: { 'Authorization': `Bearer ${authToken}` } });
                        if (response.ok) setFiles(await response.json());
                    } catch (error) { console.error("Failed to fetch files after upload:", error); }
                 };
                 fetchFilesAfterUpload();

            } else {
                try {
                    const errorResponse = JSON.parse(xhr.responseText);
                    setUploadStatus(`Upload failed: ${errorResponse.detail || xhr.statusText}`);
                } catch {
                    setUploadStatus(`Upload failed with status: ${xhr.status}`);
                }
            }
            setSelectedFile(null);
            const fileInput = document.getElementById('file-input') as HTMLInputElement;
            if(fileInput) fileInput.value = '';
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
        setUploadStatus(`Uploading ${selectedFile.name}...`);
        xhr.send(formData);
    };

    const handleCancelUpload = () => {
        if (xhrRef.current) {
            xhrRef.current.abort();
        }
    };

    const getStatusColor = (status: UserFile['status']) => {
        switch (status) {
            case 'processed': return 'text-green-400';
            case 'processing': return 'text-yellow-400';
            case 'failed': return 'text-red-400';
            default: return 'text-gray-400';
        }
    }

    return (
        <div className="flex-1 flex flex-col p-6 bg-gray-900 text-gray-200">
            <h1 className="text-2xl font-bold mb-6">Knowledge Base</h1>
            
            <div className="bg-gray-800 p-4 rounded-lg mb-6">
                <h2 className="text-lg font-semibold mb-2">Upload New Document</h2>
                {!isUploading ? (
                    <>
                        <div className="flex items-center gap-4">
                            <input id="file-input" type="file" onChange={handleFileChange} className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"/>
                            <button onClick={handleUpload} disabled={!selectedFile} className="px-4 py-2 bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                Upload
                            </button>
                        </div>
                        {uploadStatus && !isUploading && <p className="text-sm text-red-400 mt-2">{uploadStatus}</p>}
                    </>
                ) : (
                    <div className="mt-2">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium text-gray-300">{selectedFile?.name}</span>
                            <span className="text-sm font-medium text-gray-300">{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2.5">
                            <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                        </div>
                        <button onClick={handleCancelUpload} className="text-sm text-red-500 hover:text-red-400 mt-2">
                            Cancel
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-gray-800 p-4 rounded-lg flex-1 overflow-y-auto">
                <h2 className="text-lg font-semibold mb-2">Your Documents</h2>
                <div className="space-y-2">
                    {files.length > 0 ? files.map(file => (
                        <div key={file.id} className="flex justify-between items-center bg-gray-700 p-3 rounded-md">
                            <div>
                                <p className="font-medium">{file.filename}</p>
                                <p className="text-xs text-gray-400">Uploaded: {new Date(file.upload_timestamp).toLocaleString()}</p>
                            </div>
                            <p className={`text-sm font-semibold capitalize ${getStatusColor(file.status)}`}>{file.status}</p>
                        </div>
                    )) : (
                        <p className="text-gray-400">No documents uploaded yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}