import { useCallback, useEffect, useRef, useState } from "react";

/** Width frames are scaled to before they are sent to the server. */
const FRAME_WIDTH = 640;

export interface Frame {
  /** Base64 JPEG without the data: prefix. */
  image: string;
  width: number;
  height: number;
}

/** Webcam on demand. The camera only turns on when start() is called and always stops on unmount. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOn(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't access a camera here. Open the app on localhost or over HTTPS.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      // If the camera is unplugged, reflect it instead of showing a frozen frame.
      stream.getVideoTracks().forEach((t) => t.addEventListener("ended", () => stop()));
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setOn(true);
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow it in the browser's site settings."
          : name === "NotFoundError"
            ? "No camera found."
            : name === "NotReadableError"
              ? "The camera is in use by another application."
              : `Camera unavailable: ${(e as Error).message}`,
      );
      stop();
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  /** The current video frame as a ~640 px JPEG, or null when no frame is ready. */
  const capture = useCallback((): Frame | null => {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.readyState < 2 || !video.videoWidth) return null;
    const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    const image = canvas.toDataURL("image/jpeg", 0.85).split(",", 2)[1] ?? "";
    return { image, width, height };
  }, []);

  return { videoRef, on, error, start, stop, capture };
}
