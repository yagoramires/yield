import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DataProvider } from "./state/DataProvider";
import { Gate } from "./profiles/Gate";
import "./ui/theme"; // aplica o tema antes da primeira tela
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Gate><DataProvider><App /></DataProvider></Gate>
  </React.StrictMode>,
);
