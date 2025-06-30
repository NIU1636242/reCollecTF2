import { Outlet, Link } from "react-router-dom";
import Header from "../components/Header";

const Layout = () => {
    return (
      <div className="grid grid-rows-[auto_1fr_auto] min-h-screen">
        <Header/>
        <main className="w-full max-w-screen-xl mx-auto px-4 sm:px-8 py-20">
          <Outlet />
        </main>
        <footer className="text-center text-sm text-gray-500 py-6 mt-auto">
            © 2025 CollecTF. All rights reserved.
        </footer>
      </div>
    );
  };
  
  export default Layout;