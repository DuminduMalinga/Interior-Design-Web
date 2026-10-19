
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";
import { ThemeProvider } from "./app/context/ThemeContext";
import { UserProvider } from "./app/context/UserContext";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <UserProvider>
      <App />
    </UserProvider>
  </ThemeProvider>,
);
