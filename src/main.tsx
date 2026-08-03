
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
  import { ThemeProvider } from "./app/context/ThemeContext.tsx";
  import { UserProvider } from "./app/context/UserContext.tsx";

  createRoot(document.getElementById("root")!).render(
    <ThemeProvider>
      <UserProvider>
        <App />
      </UserProvider>
    </ThemeProvider>
  );
  