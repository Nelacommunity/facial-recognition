import { LiveView } from "../components/faces/LiveView";

export default function Home() {
  return (
    <main>
      <h1>Live recognition</h1>
      <p>Start the camera to label everyone who has been enrolled. Frames are processed by the app’s Python engine and never stored.</p>
      <LiveView />
    </main>
  );
}
