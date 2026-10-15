import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import StaffApp from "./StaffApp";
import StudentApp from "./StudentApp";
import "./style.css";
class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="auth-card card">
        <h1>Unable to open the workspace</h1>
        <p>Reload to try again. Your saved records have not been changed.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/enquiry" element={<StudentApp enquiry />} />
        <Route path="/student/*" element={<StudentApp />} />
        <Route path="/*" element={<StaffApp />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>,
);
