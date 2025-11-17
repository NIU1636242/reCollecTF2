import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";

export default function Step2GenomeTF() {
  const [tfName, setTfName] = useState("");
  const [tfRow, setTfRow] = useState(null);
  const [families, setFamilies] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");
  const [tfDesc, setTfDesc] = useState("");
  const [msg, setMsg] = useState(""); //Missatge per a feedback
  const [loading, setLoading] = useState(false); //Bloqueja botons mentre fa la busqueda
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    async function fetchFamilies() {
      try {
        const rows = await runQuery(`
          SELECT tf_family_id, name
          FROM core_tffamily
          ORDER BY name ASC
        `);
        setFamilies(rows); //Guarda a families la llista llegida de la BD
      } catch (e) {
        console.error("Error carregant famílies:", e);
      }
    }
    fetchFamilies();
  }, []);

  async function handleSearchTF() {
    setMsg("");
    setTfRow(null);
    setSearched(false);

    const name = tfName.trim();
    if (!name) {
      setMsg("Introdueix un nom per buscar.");
      return;
    }

    setLoading(true);
    try {
      const rows = await runQuery( //Busquem el TF i la seva familia si en té
        `
        SELECT tf.*, fam.name AS family_name
        FROM core_tf tf
        LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id
        WHERE lower(tf.name) = lower(?)
        LIMIT 1
        `,
        [name]
      );

      if (rows.length) {
        setTfRow(rows[0]);
        setMsg("TF trobat a la base de dades.");
      } else {
        setTfRow(null);
        setMsg("TF no trobat. Pots crear-lo a continuació.");
      }
      setSearched(true);
    } catch (e) {
      console.error(e);
      setMsg("Error consultant la base de dades.");
    } finally {
      setLoading(false); //Desactivem sempre el loading 
    }
  }

  function esc(str) { //Convertim a string els inputs de l'usuari per a que s'escriguin bé a la BD
    return String(str || "").replace(/'/g, "''");
  }

  async function handleCreateTF() {
    setMsg("");
    const name = tfName.trim();
    if (!name) {
      setMsg("Escriu un nom per al TF.");
      return;
    }

    setLoading(true);
    try {
      const queries = [];

      if (selectedFamily === "new") {
        if (!newFamilyName.trim()) {
          throw new Error("Has d’indicar un nom per a la nova família.");
        }

        //Creem nova família
        queries.push(
          `INSERT INTO core_tffamily (name, description)
           VALUES ('${esc(newFamilyName)}', '${esc(newFamilyDesc)}');`
        );

        //Creem TF associat a la família
        queries.push(
          `INSERT INTO core_tf (name, family_id, description)
           VALUES (
             '${esc(name)}',
             (SELECT tf_family_id FROM core_tffamily WHERE name='${esc(newFamilyName)}'),
             '${esc(tfDesc)}'
           );`
        );
      } else {
        const famId = Number(selectedFamily);
        if (!famId) throw new Error("Selecciona una família vàlida o crea’n una de nova.");

        queries.push(
          `INSERT INTO core_tf (name, family_id, description)
           VALUES ('${esc(name)}', ${famId}, '${esc(tfDesc)}');`
        );
      }

      await dispatchWorkflow({inputs: {queries: JSON.stringify(queries)}}); //Enviem l'array de queries a través de serverless.js cap a Vercel

      setMsg("Sol·licitud enviada. La base de dades s'actualitzarà automàticament després del redeploy.");
      setTfRow(null);
    } catch (e) {
      console.error(e);
      setMsg(`Error enviant les consultes: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      <div className="space-y-2">
        <label className="block font-medium">Nom del TF</label>
        <div className="flex gap-2">
          <input
            className="form-control"
            value={tfName}
            onChange={(e) => setTfName(e.target.value)} /*Establim el nou nom del TF*/
            placeholder="Exemple: LexA"
          /> 
          <button className="btn" onClick={handleSearchTF} disabled={loading}> {/*Activem handleSearchTF per buscar*/}
            {loading ? "Cercant..." : "Buscar"} 
          </button> 
        </div>
      </div>

      {msg && <p className="text-sm text-blue-300">{msg}</p>} {/*Missatge de info, errors, confirmacions...*/}

      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>
          <p><strong>ID:</strong> {tfRow.TF_id}</p>
          <p><strong>Família:</strong> {tfRow.family_name}</p>
          <p><strong>Descripció:</strong> {tfRow.description || "—"}</p>
        </div>
      )}

      {!tfRow && searched && (
        <div className="bg-surface border border-border rounded p-4 space-y-3">
          <h3 className="text-lg font-semibold text-accent">Crear un nou TF</h3>

          <div>
            <label className="block font-medium">Família existent</label>
            <select
              className="form-control"
              value={selectedFamily}
              onChange={(e) => setSelectedFamily(e.target.value)}
            >
              <option value="">Selecciona una família...</option>
              <option value="new">+ Nova família</option>
              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}> {/*Mostrar totes les famílies*/}
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {selectedFamily === "new" && (
            <>
              <div>
                <label className="block font-medium">Nom de la nova família</label>
                <input
                  className="form-control"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                  placeholder="Exemple: Família LexA"
                />
              </div>
              <div>
                <label className="block font-medium">Descripció de la família</label>
                <textarea
                  className="form-control"
                  value={newFamilyDesc}
                  onChange={(e) => setNewFamilyDesc(e.target.value)}
                  placeholder="Descripció breu de la família"
                />
              </div>
            </>
          )}

          <div>
            <label className="block font-medium">Descripció del TF</label>
            <textarea
              className="form-control"
              value={tfDesc}
              onChange={(e) => setTfDesc(e.target.value)}
              placeholder="Descripció del TF"
            />
          </div>

          <button className="btn" onClick={handleCreateTF} disabled={loading}>  {/*Activem handleCreateTF per inserir noves dades a la DB*/}
            {loading ? "Desant..." : "Desar nou TF"}
          </button>
        </div>
      )}
    </div>
  );
}
