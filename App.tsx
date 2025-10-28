
import React, { useState, useCallback, FC, useRef, useEffect } from 'react';
import { transcribeImage } from './services/geminiService';
import { Status } from './types';
import { CameraIcon, DownloadIcon, ClipboardIcon, SparklesIcon, XCircleIcon, StopCircleIcon, PencilIcon } from './components/Icons';

const App: FC = () => {
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [currentSnippet, setCurrentSnippet] = useState<string>('');
  const [status, setStatus] = useState<Status>(Status.Idle);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedTranscription, setEditedTranscription] = useState<string>('');


  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Refs and state for crop selection
  const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartPoint = useRef<{ x: number; y: number } | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);


  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
     if (videoRef.current) {
      videoRef.current.srcObject = null;
      // Clean up imperative event listeners
      videoRef.current.oncanplay = null;
      videoRef.current.onerror = null;
    }
  }, []);

  const handleStartNewSession = () => {
    stopStream();
    setLastScreenshot(null);
    setTranscription('');
    setCurrentSnippet('');
    setStatus(Status.Idle);
    setError(null);
    setIsCopied(false);
    setCropArea(null);
    setIsSelecting(false);
    setIsEditing(false);
  };

  const handleEndSession = useCallback(() => {
    stopStream();
    if(transcription || lastScreenshot) {
      setStatus(Status.Success);
    } else {
      // If nothing was captured, just go back to idle
      handleStartNewSession();
    }
  }, [stopStream, transcription, lastScreenshot]);

  const handleStartCapture = useCallback(async () => {
    setStatus(Status.Capturing);
    setError(null);
    setTranscription('');
    setLastScreenshot(null);
    setCropArea(null);
    setIsEditing(false);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });
      
      streamRef.current = stream;

      // Listen for the user clicking the browser's "Stop sharing" button
      stream.getVideoTracks()[0].onended = () => {
        handleEndSession();
      };

      // Set status to streaming to trigger the rendering of the video element
      setStatus(Status.Streaming);

    } catch (err: any) {
      console.error('Capture failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
         handleStartNewSession(); // Go back to idle if user cancels
         return;
      }
      setError('Failed to start screen capture. Please check permissions and try again.');
      setStatus(Status.Error);
    }
  }, [handleEndSession]);

  // Effect to attach the stream to the video element once it's rendered
  useEffect(() => {
    if (status === Status.Streaming && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
      
        video.oncanplay = () => {
          video.play().catch(e => {
            console.error("Video play failed:", e);
            setError("Could not play the screen share stream.");
            setStatus(Status.Error);
          });
        };
        video.onerror = () => {
            setError("There was an error with the video stream.");
            setStatus(Status.Error);
        };
      }
    }
  }, [status]);


  const handleTakeSnapshot = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState < 2) {
      setError("Video stream is not ready.");
      setStatus(Status.Error);
      return;
    };
    if (!cropArea) {
      setError("Please select an area on the preview to capture.");
      // Keep status as streaming to allow user to select
      return;
    }
    
    setStatus(Status.Transcribing);
    setError(null);

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    
    const scaleX = video.videoWidth / video.clientWidth;
    const scaleY = video.videoHeight / video.clientHeight;

    const sx = cropArea.x * scaleX;
    const sy = cropArea.y * scaleY;
    const sWidth = cropArea.width * scaleX;
    const sHeight = cropArea.height * scaleY;

    if (sWidth < 1 || sHeight < 1) {
      setStatus(Status.Streaming);
      return;
    }

    canvas.width = sWidth;
    canvas.height = sHeight;
    const context = canvas.getContext('2d');
    
    if (context) {
      context.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
      const dataUrl = canvas.toDataURL('image/png');
      setLastScreenshot(dataUrl);

      try {
        const base64Data = dataUrl.split(',')[1];
        const result = await transcribeImage(base64Data);
        setCurrentSnippet(result);
        setStatus(Status.Reviewing); // Enter review mode
      } catch(err) {
         console.error('Transcription failed:', err);
         setError('Transcription failed. Please try another snapshot.');
         // We don't want to kill the session, so we go back to streaming.
         setStatus(Status.Streaming);
      }
    } else {
        setError('Could not get canvas context to take a snapshot.');
        setStatus(Status.Error);
    }
  }, [cropArea]);

  const handleSaveAndContinue = () => {
    setTranscription(prev => prev ? `${prev}\n\n${currentSnippet}` : currentSnippet);
    setCurrentSnippet('');
    setLastScreenshot(null); // Clear snapshot preview after saving
    setStatus(Status.Streaming);
  };

  const handleDiscardSnippet = () => {
    setCurrentSnippet('');
    setLastScreenshot(null); // Clear snapshot preview after discarding
    setStatus(Status.Streaming);
  };

  const handleDownload = () => {
    if (!transcription) return;
    const blob = new Blob([transcription], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (!transcription) return;
    navigator.clipboard.writeText(transcription).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // Cleanup effect
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoContainerRef.current) return;
    setError(null); // Clear previous errors on new selection
    setIsSelecting(true);
    const rect = videoContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    selectionStartPoint.current = { x, y };
    setCropArea({ x, y, width: 0, height: 0 }); // Reset/start crop area
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isSelecting || !selectionStartPoint.current || !videoContainerRef.current) return;
      const rect = videoContainerRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      const startX = selectionStartPoint.current.x;
      const startY = selectionStartPoint.current.y;

      const newX = Math.min(startX, currentX);
      const newY = Math.min(startY, currentY);
      const newWidth = Math.abs(currentX - startX);
      const newHeight = Math.abs(currentY - startY);

      setCropArea({ x: newX, y: newY, width: newWidth, height: newHeight });
  };

  const handleMouseUp = () => {
      setIsSelecting(false);
      if (cropArea && (cropArea.width < 10 || cropArea.height < 10)) {
          setCropArea(null); // Reset if selection is too small to be useful
      }
  };

  const handleMouseLeave = () => {
      if (isSelecting) {
        handleMouseUp();
      }
  };


  const isSessionActive = [Status.Streaming, Status.Transcribing, Status.Reviewing].includes(status);
  
  const renderContent = () => {
     switch (status) {
      case Status.Idle:
        return (
          <button
            onClick={handleStartCapture}
            className="flex items-center justify-center gap-3 px-8 py-4 bg-primary text-on-primary font-semibold rounded-lg shadow-lg hover:bg-primary-light transform hover:-translate-y-1 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary"
          >
            <CameraIcon className="w-6 h-6" />
            Start Screen Capture
          </button>
        );
      case Status.Capturing:
        return (
          <div className="text-center p-8 bg-surface rounded-lg shadow-md">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-lg font-semibold text-on-surface">
              Waiting for screen selection...
            </p>
            <p className="text-gray-400">Please select a screen, window, or tab to share.</p>
          </div>
        );
      case Status.Error:
        return (
          <div className="w-full max-w-md text-center p-6 bg-red-900/50 border border-red-700 rounded-lg shadow-lg">
             <XCircleIcon className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-red-300">An Error Occurred</h3>
            <p className="text-red-400 mt-2">{error}</p>
             <button
            onClick={handleStartNewSession}
            className="mt-6 flex items-center justify-center gap-2 px-6 py-2 bg-primary text-on-primary font-semibold rounded-lg shadow-md hover:bg-primary-light transition-colors duration-200"
            >
              Start New Session
            </button>
          </div>
        );
      case Status.Streaming:
      case Status.Transcribing:
      case Status.Reviewing:
      case Status.Success:
        return (
           <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8 items-start animate-fade-in">
              {/* Left Panel: Video Preview / Last Screenshot */}
              <div className="flex flex-col gap-4">
                <h2 className="text-2xl font-bold text-on-surface">{isSessionActive ? 'Live Preview' : 'Last Captured Image'}</h2>
                <div
                  ref={videoContainerRef}
                  onMouseDown={isSessionActive ? handleMouseDown : undefined}
                  onMouseMove={isSessionActive ? handleMouseMove : undefined}
                  onMouseUp={isSessionActive ? handleMouseUp : undefined}
                  onMouseLeave={isSessionActive ? handleMouseLeave : undefined}
                  className="relative bg-surface p-2 rounded-lg shadow-lg border border-gray-700 aspect-video flex items-center justify-center text-gray-500"
                  style={{ cursor: isSessionActive && status !== Status.Reviewing ? 'crosshair' : 'default' }}
                  >
                   {isSessionActive && status !== Status.Reviewing && (
                      <div className="absolute inset-2 z-10 pointer-events-none">
                        {cropArea && (
                          <div
                            className="absolute border-2 border-dashed border-primary bg-primary/20"
                            style={{
                              left: cropArea.x,
                              top: cropArea.y,
                              width: cropArea.width,
                              height: cropArea.height,
                            }}
                          />
                        )}
                      </div>
                    )}
                   {isSessionActive && status !== Status.Success ? (
                    <>
                     <video ref={videoRef} muted className={`w-full rounded-md ${status === Status.Reviewing ? 'filter blur-sm' : ''}`} playsInline /> 
                      {status === Status.Streaming && !cropArea && <p className="absolute text-center p-4 bg-black/50 rounded-md">Drag on the preview to select an area to transcribe.</p>}
                    </>
                   ) : null}
                   {status === Status.Success && lastScreenshot && <img src={lastScreenshot} alt="Last screen capture" className="rounded-md w-full object-contain max-h-[50vh]" />}
                   {status === Status.Success && !lastScreenshot && <p>No images were captured.</p>}
                </div>
                 {isSessionActive && lastScreenshot && (
                  <>
                    <h3 className="text-xl font-bold text-on-surface mt-4">Last Snapshot</h3>
                    <div className="bg-surface p-2 rounded-lg shadow-lg border border-gray-700">
                        <img src={lastScreenshot} alt="Last screen capture" className="rounded-md w-full object-contain" />
                    </div>
                  </>
                )}
              </div>

               {/* Right Panel: Controls and Transcription */}
               <div className="flex flex-col gap-4">
                <h2 className="text-2xl font-bold text-on-surface">
                  {status === Status.Reviewing ? 'Review Snapshot' : 'Transcription'}
                </h2>
                <div className="bg-surface p-4 rounded-lg shadow-lg border border-gray-700 min-h-[300px] h-full max-h-[60vh] overflow-y-auto relative flex flex-col">
                  {status === Status.Reviewing ? (
                      <textarea
                          value={currentSnippet}
                          onChange={(e) => setCurrentSnippet(e.target.value)}
                          className="flex-grow w-full bg-gray-900 text-on-surface font-sans text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary rounded-md p-2 resize-none"
                          autoFocus
                          aria-label="Editable snapshot transcription"
                      />
                  ) : isEditing ? (
                      <textarea
                          value={editedTranscription}
                          onChange={(e) => setEditedTranscription(e.target.value)}
                          className="flex-grow w-full bg-gray-900 text-on-surface font-sans text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary rounded-md p-2 resize-none"
                          autoFocus
                          aria-label="Editable transcription text"
                      />
                  ) : (
                      <pre className="flex-grow text-on-surface whitespace-pre-wrap font-sans text-base leading-relaxed p-2">
                          {transcription || <span className="text-gray-500">Transcribed text will appear here...</span>}
                      </pre>
                  )}
                  
                  {status === Status.Success && transcription && !isEditing && (
                      <div className="absolute top-2 right-2 flex gap-2">
                          <button 
                              onClick={() => { setIsEditing(true); setEditedTranscription(transcription); }} 
                              className="p-2 bg-gray-800 rounded-md hover:bg-gray-700 transition-colors" 
                              title="Edit transcription"
                              aria-label="Edit transcription"
                          >
                              <PencilIcon className="w-5 h-5 text-gray-300" />
                          </button>
                          <button onClick={handleCopy} className="p-2 bg-gray-800 rounded-md hover:bg-gray-700 transition-colors" title="Copy to clipboard" aria-label="Copy transcription to clipboard">
                              <ClipboardIcon className={`w-5 h-5 ${isCopied ? 'text-green-400' : 'text-gray-300'}`} />
                          </button>
                          <button onClick={handleDownload} className="p-2 bg-gray-800 rounded-md hover:bg-gray-700 transition-colors" title="Download as .txt" aria-label="Download transcription as a text file">
                              <DownloadIcon className="w-5 h-5 text-gray-300" />
                          </button>
                      </div>
                  )}
                </div>
                {/* Action Buttons */}
                <div className="flex flex-col items-start gap-4 mt-4">
                    {error && !isEditing && <p className="text-red-400">{error}</p>}
                    
                    {status === Status.Reviewing ? (
                      <div className="flex items-center gap-4 self-end w-full justify-end">
                          <button
                              onClick={handleDiscardSnippet}
                              className="px-4 py-2 bg-gray-600 text-on-primary font-semibold rounded-lg shadow-md hover:bg-gray-700 transition-all duration-200"
                          >
                              Discard
                          </button>
                          <button
                              onClick={handleSaveAndContinue}
                              className="px-4 py-2 bg-primary text-on-primary font-semibold rounded-lg shadow-md hover:bg-primary-light transition-all duration-200"
                          >
                              Save & Continue
                          </button>
                      </div>
                    ) : isEditing ? (
                        <div className="flex items-center gap-4 self-end w-full justify-end">
                            <button
                                onClick={() => setIsEditing(false)}
                                className="px-4 py-2 bg-gray-600 text-on-primary font-semibold rounded-lg shadow-md hover:bg-gray-700 transition-all duration-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { setTranscription(editedTranscription); setIsEditing(false); }}
                                className="px-4 py-2 bg-primary text-on-primary font-semibold rounded-lg shadow-md hover:bg-primary-light transition-all duration-200"
                            >
                                Save Changes
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4">
                          {/* FIX: This condition was redundant. In this code branch, status is guaranteed not to be 'Reviewing', so the second part of the condition is always true and can be removed to fix the TypeScript error. */}
                          {isSessionActive && (
                              <>
                              <button
                                  onClick={handleTakeSnapshot}
                                  disabled={status === Status.Transcribing || !cropArea}
                                  className="flex items-center justify-center gap-3 px-6 py-3 bg-primary text-on-primary font-semibold rounded-lg shadow-md hover:bg-primary-light transform hover:-translate-y-0.5 transition-all duration-200 disabled:bg-gray-500 disabled:cursor-not-allowed disabled:transform-none"
                                  title={!cropArea ? "Please select an area on the preview first" : "Take a snapshot of the selected area"}
                              >
                                  <CameraIcon className="w-5 h-5" />
                                  {status === Status.Transcribing ? 'Transcribing...' : 'Take Snapshot'}
                              </button>
                              <button
                                  onClick={handleEndSession}
                                  className="flex items-center justify-center gap-3 px-6 py-3 bg-red-600 text-on-primary font-semibold rounded-lg shadow-md hover:bg-red-700 transform hover:-translate-y-0.5 transition-all duration-200"
                              >
                                  <StopCircleIcon className="w-5 h-5" />
                                  End Session
                              </button>
                              </>
                          )}
                          {status === Status.Success && (
                              <button
                                  onClick={handleStartNewSession}
                                  className="flex items-center justify-center gap-3 px-6 py-3 bg-primary text-on-primary font-semibold rounded-lg shadow-md hover:bg-primary-light transform hover:-translate-y-0.5 transition-all duration-200"
                              >
                                  <SparklesIcon className="w-5 h-5" />
                                  Start New Session
                              </button>
                          )}
                        </div>
                    )}
                </div>
              </div>
           </div>
        );
        default:
          return null;
     }
  }

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col items-center justify-center p-4 md:p-8">
      <main className="w-full max-w-6xl mx-auto flex flex-col items-center">
        {/* Header */}
        <header className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold text-on-surface tracking-tight flex items-center justify-center gap-3">
                <SparklesIcon className="w-10 h-10 text-primary" />
                ScreenScribe AI
            </h1>
            <p className="mt-4 text-lg text-gray-400 max-w-2xl">
                Capture your screen multiple times in one session and transcribe text with Gemini.
            </p>
        </header>
        
        {renderContent()}

      </main>
    </div>
  );
};

export default App;
