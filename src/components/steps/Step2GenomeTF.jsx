import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";

export default function Step2GenomeTF() {
  const [tfName, setTfName] = useState("");
  const [tfRow, setTfRow] = useState(null);
  const [families, setFamilies] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");
  const [tfDesc, setTfDesc] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false); //controla si ja s’ha fet una cerca

  useEffect(() => {
    async function fetchFamilies() {
      try {
        const rows = await runQuery(`
          SELECT tf_family_id, name
          FROM core_tffamily
          ORDER BY name ASC
        `);
        setFamilies(rows);
      } catch (e) {
        console.error("Error carregant famílies:", e);
      }
    }
    fetchFamilies();
  }, []);

  // 🔹 Buscar TF existent
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
      const rows = await runQuery(
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
      setLoading(false);
    }
  }

  // 🔹 Crear una família si no existeix i retornar el seu ID
  async function ensureFamilyId() {
    if (selectedFamily && selectedFamily !== "new") {
      return selectedFamily;
    }
    if (!newFamilyName.trim()) {
      throw new Error("Has d’indicar un nom per a la nova família.");
    }

    await runQuery(
      `INSERT INTO core_tffamily (name, description) VALUES (?, ?)`,
      [newFamilyName.trim(), newFamilyDesc.trim()]
    );
    const idRow = await runQuery(`SELECT last_insert_rowid() AS id`);
    return idRow[0].id;
  }

  // 🔹 Crear un nou TF
  async function handleCreateTF() {
    setMsg("");
    const name = tfName.trim();
    if (!name) {
      setMsg("Escriu un nom per al TF.");
      return;
    }

    setLoading(true);
    try {
      const famId = await ensureFamilyId();

      await runQuery(
        `INSERT INTO core_tf (name, family_id, description) VALUES (?, ?, ?)`,
        [name, famId, tfDesc.trim()]
      );

      const newTF = await runQuery(
        `
        SELECT tf.*, fam.name AS family_name 
        FROM core_tf tf 
        LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id 
        WHERE lower(tf.name)=lower(?) 
        LIMIT 1
        `,
        [name]
      );

      setTfRow(newTF[0]);
      setMsg("TF creat correctament.");
    } catch (e) {
      console.error(e);
      setMsg("Error creant el TF o la família.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      {/* Buscar TF */}
      <div className="space-y-2">
        <label className="block font-medium">Nom del TF</label>
        <div className="flex gap-2">
          <input
            className="form-control"
            value={tfName}
            onChange={(e) => setTfName(e.target.value)}
            placeholder="Exemple: LexA"
          />
          <button className="btn" onClick={handleSearchTF} disabled={loading}>
            {loading ? "Cercant..." : "Buscar"}
          </button>
        </div>
        <p className="text-sm text-gray-400">
          Escriu el nom del factor de transcripció i prem <strong>Buscar</strong>.
        </p>
      </div>

      {/* Missatge d’estat */}
      {msg && <p className="text-sm text-blue-300">{msg}</p>}

      {/* TF trobat */}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>
          <p><strong>ID:</strong> {tfRow.TF_id}</p>
          <p><strong>Família:</strong> {tfRow.family_name}</p>
          <p><strong>Descripció:</strong> {tfRow.description || "—"}</p>
        </div>
      )}

      {/* Si no existeix TF (només després de buscar) */}
      {!tfRow && searched && (
        <div className="bg-surface border border-border rounded p-4 space-y-3">
          <h3 className="text-lg font-semibold text-accent">Crear un nou TF</h3>

          {/* Selector de família */}
          <div>
            <label className="block font-medium">Família existent</label>
            <select
              className="form-control"
              value={selectedFamily}
              onChange={(e) => setSelectedFamily(e.target.value)}
            >
              <option value="">Selecciona una família...</option>
              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}>
                  {f.name}
                </option>
              ))}
              <option value="new">➕ Nova família</option>
            </select>
          </div>

          {/* Camps de nova família */}
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

          {/* Descripció TF */}
          <div>
            <label className="block font-medium">Descripció del TF</label>
            <textarea
              className="form-control"
              value={tfDesc}
              onChange={(e) => setTfDesc(e.target.value)}
              placeholder="Descripció del TF"
            />
          </div>

          <button className="btn" onClick={handleCreateTF} disabled={loading}>
            {loading ? "Desant..." : "Desar nou TF"}
          </button>
        </div>
      )}
    </div>
  );
}
