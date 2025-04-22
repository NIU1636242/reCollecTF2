import { Outlet, Link } from "react-router-dom";
import Header from "../components/Header";
import "./Layout.css";

const Layout = () => {
    return (
      <div className="app-layout">
        <Header/>
        <main className="main-content">
          <Outlet />
        </main>
        {/* Footer can be added here if needed */}
      </div>
    );
  };
  
  export default Layout;