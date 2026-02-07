import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected error" };
  }

  componentDidCatch(error, info) {
    if (this.props.onError) {
      this.props.onError(error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>We hit a rendering issue</h2>
          <p className="error-boundary__message">{this.state.message}</p>
          <p className="error-boundary__hint">
            Refresh the page or verify the backend is running. If the issue persists, contact the
            platform admin.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
