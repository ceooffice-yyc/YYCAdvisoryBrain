// Screens that are downloaded the first time they are needed (PERF-01), with a safe way to try again when the download fails.
//
//   const ChatPanel = lazyScreen(() => import("./screens/ChatPanel.jsx"), "ChatPanel");
//   <ScreenBoundary><Suspense fallback={...}><ChatPanel ... /></Suspense></ScreenBoundary>
//
// While a screen downloads, the Suspense fallback (a grey placeholder) is shown. If the download fails (offline, a slow network), the
// boundary (src/ui/ScreenBoundary.jsx) shows a message with a "Try again" button instead of a blank page. `ChatPanel.preload()` starts the
// download early, for example when the pointer is over the tab that opens it.
import { createElement, lazy } from "react";

const resets = [];

export function lazyScreen(importer, exportName) {
  let promise = null;
  const make = () => lazy(() => (promise ||= importer().then((m) => ({ default: m[exportName] })).catch((e) => { promise = null; throw e; })));
  let Current = make();
  const Screen = (props) => createElement(Current, props);
  Screen.preload = () => { try { importer().catch(() => {}); } catch { /* the real attempt reports the failure */ } };
  resets.push(() => { Current = make(); promise = null; }); // after a failure: the next attempt starts afresh
  return Screen;
}

/* Called by the "Try again" button: every screen forgets a failed download. */
export const resetScreens = () => resets.forEach((r) => r());
