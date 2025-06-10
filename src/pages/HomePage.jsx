import { useEffect } from "react";
import { testQuery } from "../db/queries/search"; 

function AppPage() {

  useEffect(() => {
    testQuery()
      .then((result) => {
        console.log(result);
      })
      .catch((error) => {
        console.error("Error fetching data:", error);
      });

  }, []);


  return (
    <>
      <h1 className="text-5xl mb-4">Welcome to CollecTF</h1>
      <p>Developing Home Page</p>
    </>
  );
}
export default AppPage;