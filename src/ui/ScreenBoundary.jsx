// Catches a failed screen download (or any error inside a screen) and offers another try, instead of leaving a blank page.
import { Component } from "react";
import { P } from "../theme.js";
import { resetScreens } from "../lazyScreen.js";

export class ScreenBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("a screen could not be shown:", error && error.message); }
  retry = () => { resetScreens(); this.setState({ failed: false }); };
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ padding: "40px 20px", textAlign: "center", color: P.ink }}>
        <div style={{ fontSize: 17, fontWeight: 750, marginBottom: 6 }}>This part could not be loaded</div>
        <div style={{ fontSize: 14, color: P.sub, marginBottom: 16, lineHeight: 1.5 }}>Check your internet connection, then try again. Nothing you did has been lost.</div>
        <button className="yyc-btn-primary" onClick={this.retry}>Try again</button>
      </div>
    );
  }
}
