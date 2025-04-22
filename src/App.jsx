import { BrowserRouter, Routes, Route } from "react-router-dom";
import ReactDOM from "react-dom/client";
import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import SearchTF from "./pages/SearchTF";
import SearchSpecies from "./pages/SearchSpecies";
import SearchExpTechniques from "./pages/SearchExpTechniques";

function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/CollecTF" element={<Layout/>}>
          <Route index element={<HomePage />} />
          <Route path="Search" element={<SearchPage />} >
            <Route path="1" element={<SearchTF />} />
            <Route path="2" element={<SearchSpecies />} />
            <Route path="3" element={<SearchExpTechniques />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App;