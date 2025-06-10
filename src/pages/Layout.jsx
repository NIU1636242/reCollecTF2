import { Outlet, Link } from "react-router-dom";
import Header from "../components/Header";

const Layout = () => {
    return (
      <div className="grid grid-rows-[auto_1fr] min-h-screen">
        <Header/>
        <main className="w-full max-w-screen-xl mx-auto px-4 sm:px-8 py-20">
          <Outlet />
        </main>
        {/* Footer can be added here if needed */}
      </div>
    );
  };
  
  export default Layout;