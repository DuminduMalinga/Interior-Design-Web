<div align="center">

# 🏠 InteriorAI

### _Transform floor plans into stunning 3D spaces — powered by AI_

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![MUI](https://img.shields.io/badge/MUI-7-007FFF?style=for-the-badge&logo=mui&logoColor=white)](https://mui.com)
[![Supabase](https://img.shields.io/badge/Supabase-Backend-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)

<br/>

> Upload a 2D floor plan → AI detects every room → browse scored layouts → explore in 3D.  
> **From blueprint to reality in under 15 seconds.**

</div>

---

## ✨ Features

| Icon | Feature | Description |
|:----:|---------|-------------|
| 🔍 | **AI Room Detection** | Instantly maps every room, wall, door & window from any 2D floor plan image |
| 🪑 | **Smart Furniture Placement** | Scores hundreds of layout combinations and surfaces only the best-fit arrangements |
| 🧊 | **Interactive 3D Viewer** | Real-time isometric 3D viewer — rotate, zoom, and export in one click |
| 📊 | **User Dashboard** | Manage projects, view design history, and configure profile & notifications |
| 🛡️ | **Admin Panel** | Dedicated interface for user account management |
| 🌗 | **Dark / Light Theme** | Full theme switching powered by a global `ThemeContext` |
| 🔐 | **Authentication Flow** | Sign up, sign in, forgot-password & full password reset with form validation |
| ☁️ | **Supabase Backend** | Cloud database, auth, and storage powered by Supabase |

---

## 🚀 Performance Highlights

```
⚡  < 15s    AI processing time per floor plan
🎯  98%      Room detection accuracy
📐  500+     Layouts scored per session
🏡  10k+     Rooms designed and counting
```

---

## 🛠️ Tech Stack

<table>
  <thead>
    <tr>
      <th>🏷️ Layer</th>
      <th>⚙️ Technology</th>
      <th>📌 Version</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>⚛️ Framework</td><td><a href="https://react.dev">React</a> + <a href="https://www.typescriptlang.org/">TypeScript</a></td><td>18 / 5</td></tr>
    <tr><td>⚡ Build Tool</td><td><a href="https://vitejs.dev">Vite</a></td><td>6</td></tr>
    <tr><td>🧭 Routing</td><td><a href="https://reactrouter.com">React Router</a></td><td>v7</td></tr>
    <tr><td>🎨 Styling</td><td><a href="https://tailwindcss.com">Tailwind CSS</a></td><td>v4</td></tr>
    <tr><td>🧩 UI Primitives</td><td><a href="https://www.radix-ui.com">Radix UI</a> (shadcn/ui)</td><td>latest</td></tr>
    <tr><td>🖼️ Component Lib</td><td><a href="https://mui.com">Material UI (MUI)</a></td><td>v7</td></tr>
    <tr><td>🎞️ Animation</td><td><a href="https://motion.dev">Motion (Framer Motion)</a></td><td>12</td></tr>
    <tr><td>📋 Forms</td><td><a href="https://react-hook-form.com">React Hook Form</a></td><td>7</td></tr>
    <tr><td>🖱️ Drag & Drop</td><td><a href="https://react-dnd.github.io/react-dnd/">React DnD</a></td><td>16</td></tr>
    <tr><td>📈 Charts</td><td><a href="https://recharts.org">Recharts</a></td><td>2</td></tr>
    <tr><td>🔔 Notifications</td><td><a href="https://sonner.emilkowal.ski">Sonner</a></td><td>2</td></tr>
    <tr><td>☁️ Backend</td><td><a href="https://supabase.com">Supabase</a></td><td>2</td></tr>
    <tr><td>🖼️ Icons</td><td><a href="https://lucide.dev">Lucide React</a> + MUI Icons</td><td>latest</td></tr>
  </tbody>
</table>

---

## 📁 Project Structure

```
📦 src/
 ┣ 📄 main.tsx                    ← Application entry point
 ┗ 📂 app/
    ┣ 📄 App.tsx                  ← Root component
    ┣ 📄 routes.ts                ← React Router configuration
    ┣ 📂 components/
    ┃  ┣ 📂 figma/                ← Figma-generated helper components
    ┃  ┗ 📂 ui/                   ← shadcn/ui component library (30+ components)
    ┣ 📂 context/
    ┃  ┣ 📄 ThemeContext.tsx      ← Global dark/light theme provider
    ┃  ┗ 📄 UserContext.tsx       ← Authenticated user state provider
    ┣ 📂 lib/
    ┃  ┗ 📄 supabaseClient.ts    ← Supabase client initialisation
    ┣ 📂 pages/
    ┃  ┣ 🏠 Welcome.tsx           ← Landing page with features & testimonials
    ┃  ┣ 🔐 SignIn.tsx            ← User login
    ┃  ┣ 📝 SignUp.tsx            ← New user registration
    ┃  ┣ 🔑 ForgotPassword.tsx   ← Password reset request flow
    ┃  ┣ 🔏 ResetPassword.tsx    ← Password reset (email link handler)
    ┃  ┣ 📊 Dashboard.tsx         ← Project history, profile & settings
    ┃  ┣ 📤 UploadFloorPlan.tsx   ← Floor plan upload
    ┃  ┣ ⏳ Processing.tsx        ← AI analysis progress screen
    ┃  ┣ 🏷️ SelectRoom.tsx        ← Room selection post-detection
    ┃  ┣ 🗂️ ViewLayouts.tsx       ← AI-scored layout gallery
    ┃  ┣ 🧊 RoomView3D.tsx        ← Interactive isometric 3D viewer
    ┃  ┗ 🛡️ AdminManageAccounts.tsx ← Admin user management panel
    ┗ 📂 styles/
       ┣ 📄 index.css
       ┣ 📄 tailwind.css
       ┣ 📄 theme.css
       ┗ 📄 fonts.css
```

---

## 🗺️ Application Routes

| 🔗 Path | 📄 Page | 📝 Description |
|---------|---------|----------------|
| `/` | 🏠 Welcome | Landing page — features, stats & testimonials |
| `/signup` | 📝 SignUp | New user registration |
| `/signin` | 🔐 SignIn | User login |
| `/forgot-password` | 🔑 ForgotPassword | Password reset request |
| `/reset-password` | 🔏 ResetPassword | Password reset via email link |
| `/dashboard` | 📊 Dashboard | History, profile & account settings |
| `/upload` | 📤 UploadFloorPlan | Upload a 2D floor plan image |
| `/processing` | ⏳ Processing | AI analysis progress screen |
| `/select-room` | 🏷️ SelectRoom | Pick a detected room to optimize |
| `/view-layouts` | 🗂️ ViewLayouts | Browse AI-ranked furniture layouts |
| `/room-view-3d` | 🧊 RoomView3D | Interactive isometric 3D viewer |
| `/admin/accounts` | 🛡️ AdminManageAccounts | Admin user management |

---

## 🏁 Getting Started

### 📋 Prerequisites

- 🟢 [Node.js](https://nodejs.org/) v18 or later
- 📦 `npm`, `pnpm`, or `yarn`
- ☁️ A [Supabase](https://supabase.com) project (for backend features)

### ⬇️ Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd Interiordesignweb

# 2. Install dependencies
npm install
# or with pnpm
pnpm install
```

### 🔧 Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 💻 Development Server

```bash
npm run dev
```

> 🌐 App runs at **http://localhost:5173**

### 📦 Production Build

```bash
npm run build
```

> 📂 Output lands in the `dist/` directory — ready for any static host.

---

## 🎨 Design Source

Original Figma design → [View on Figma](https://www.figma.com/design/4nfXiCDREIVxzBClpAnTQN/Untitled)

---

## 📄 License & Attributions

See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for third-party attributions and licensing information.

---

<div align="center">

 ⚛️ Built with React &nbsp;+&nbsp; ⚡ Vite &nbsp;+&nbsp; ☁️ Supabase 

</div>
