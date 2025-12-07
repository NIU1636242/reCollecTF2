import React, { useState, useEffect } from "react";
import { Accordion, AccordionSummary, AccordionDetails } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";


// --------------------------------------
// utils
// --------------------------------------

function reverseComplement(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((c) => map[c] || "N")
    .join("");
}

function countMismatches(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function buildAlignmentBars(a, b) {
  let bars = "";
  for (let i = 0; i < a.length; i++) {
    bars += a[i] === b[i] ? "|" : " ";
  }
  return bars;
}


// --------------------------------------
// search functions
// --------------------------------------

function findExactMatches(genome, motif, annotations) {
  const results = [];

  // forward
  for (let i = 0; i <= genome.length - motif.length; i++) {
    const sub = genome.slice(i, i + motif.length);
    if (sub === motif) {
      results.push({
        start: i,
        end: i + motif.length,
        strand: "+",
        match: sub,
        locus: findGeneAt(annotations, i),
      });
    }
  }

  // reverse-complement
  const rc = reverseComplement(motif);
  for (let i = 0; i <= genome.length - motif.length; i++) {
    const sub = genome.slice(i, i + motif.length);
    if (sub === rc) {
      results.push({
        start: i,
        end: i + motif.length,
        strand: "-",
        match: sub,
        locus: findGeneAt(annotations, i),
      });
    }
  }

  return results;
}


function findFuzzyMatches(genome, motif, annotations, maxMismatch = 2) {
  const results = [];
  const rc = reverseComplement(motif);

  for (let i = 0; i <= genome.length - motif.length; i++) {
    const sub = genome.slice(i, i + motif.length);

    // forward
    const mmF = countMismatches(sub, motif);
    if (mmF > 0 && mmF <= maxMismatch) {
      results.push({
        start: i,
        end: i + motif.length,
        strand: "+",
        match: sub,
        motif,
        bars: buildAlignmentBars(motif, sub),
        mismatches: mmF,
        locus: findGeneAt(annotations, i),
      });
    }

    // reverse
    const mmR = countMismatches(sub, rc);
    if (mmR > 0 && mmR <= maxMismatch) {
      results.push({
        start: i,
        end: i + motif.length,
        strand: "-",
        match: sub,
        motif: rc,
        bars: buildAlignmentBars(rc, sub),
        mismatches: mmR,
        locus: findGeneAt(annotations, i),
      });
    }
  }

  return results;
}


// --------------------------------------
// gene lookup (simple)
// --------------------------------------

function findGeneAt(annotations, pos) {
  if (!annotations) return null;

  for (const gene of annotations) {
    if (pos >= gene.start && pos <= gene.end) {
      return {
        tag: gene.locus_tag || "",
        name: gene.gene || "",
        function: gene.product || "",
      };
    }
  }

  return null;
}


// --------------------------------------
// UI components
// --------------------------------------

function ExactMatchCard({ item }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: "bold" }}>{item.match}</div>
      <div>
        {item.strand}[{item.start}, {item.end}]
      </div>

      {item.locus && (
        <table>
          <thead>
            <tr>
              <th>locus tag</th>
              <th>gene name</th>
              <th>function</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{item.locus.tag}</td>
              <td>{item.locus.name}</td>
              <td>{item.locus.function}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function FuzzyMatchCard({ item }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <pre style={{ margin: 0 }}>{item.motif}</pre>
      <pre style={{ margin: 0 }}>{item.bars}</pre>
      <pre style={{ margin: 0 }}>{item.match}</pre>

      <div>
        {item.strand}[{item.start}, {item.end}]
      </div>

      {item.locus && (
        <table>
          <thead>
            <tr>
              <th>locus tag</th>
              <th>gene name</th>
              <th>function</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{item.locus.tag}</td>
              <td>{item.locus.name}</td>
              <td>{item.locus.function}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}


// =====================================================================
// STEP4 COMPONENT
// =====================================================================

export default function Step4({
  userSequence,
  genomeSequence,
  annotations,
}) {
  const [exactMatches, setExactMatches] = useState([]);
  const [fuzzyMatches, setFuzzyMatches] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);


  // ---------------------------------------------------
  // find exact matches on mount
  // ---------------------------------------------------
  useEffect(() => {
    if (genomeSequence && userSequence) {
      const res = findExactMatches(genomeSequence, userSequence, annotations);
      setExactMatches(res);
    }
  }, [genomeSequence, userSequence, annotations]);


  // ---------------------------------------------------
  // when user picks "No valid match" compute fuzzy
  // ---------------------------------------------------
  useEffect(() => {
    if (selectedOption === "no_valid") {
      const res = findFuzzyMatches(genomeSequence, userSequence, annotations, 2);
      setFuzzyMatches(res);
    }
  }, [selectedOption, genomeSequence, userSequence, annotations]);


  return (
    <div style={{ marginTop: 30 }}>

      {/* ---------------------- */}
      {/* ACCORDION 1 - NO CHANGE */}
      {/* ---------------------- */}

      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          Reported sites
        </AccordionSummary>
        <AccordionDetails>

          {/* AQUI VA EXACTAMENTE TU COMPONENTE ORIGINAL */}
          {/* NO LO MODIFICO */}

          <div>
            {/* ... tu código original ... */}
            {/* ... opciones radio y textarea ... */}
          </div>

        </AccordionDetails>
      </Accordion>


      {/* ---------------------- */}
      {/* ACCORDION 2 - EXACT MATCHES */}
      {/* ---------------------- */}

      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          Exact matches
        </AccordionSummary>
        <AccordionDetails>

          {exactMatches.map((m, i) => (
            <ExactMatchCard key={i} item={m} />
          ))}

          {/* opción "No valid match" */}
          <div style={{ marginTop: 15 }}>
            <label>
              <input
                type="radio"
                name="match_type"
                value="no_valid"
                onChange={() => setSelectedOption("no_valid")}
              />
              &nbsp;No valid match.
            </label>
          </div>

        </AccordionDetails>
      </Accordion>


      {/* ---------------------- */}
      {/* ACCORDION 3 - FUZZY MATCHES */}
      {/* ---------------------- */}

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          Near matches (1–2 mismatches)
        </AccordionSummary>
        <AccordionDetails>

          {selectedOption !== "no_valid" && (
            <p>Seleccione "No valid match" en el acordeón anterior.</p>
          )}

          {selectedOption === "no_valid" && fuzzyMatches.length === 0 && (
            <p>No near matches found (1–2 mismatches)</p>
          )}

          {selectedOption === "no_valid" &&
            fuzzyMatches.map((m, i) => (
              <FuzzyMatchCard key={i} item={m} />
            ))}

        </AccordionDetails>
      </Accordion>



      {/* ---------------------- */}
      {/* ACCORDION 4 - EMPTY */}
      {/* ---------------------- */}

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          Summary
        </AccordionSummary>
        <AccordionDetails>
          {/* Dejar vacío */}
        </AccordionDetails>
      </Accordion>

    </div>
  );
}
