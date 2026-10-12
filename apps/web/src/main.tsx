import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./i18n";
import "./style.css";
import { App } from "./App";
export const client = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
    mutations: { networkMode: "always", retry: false },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
