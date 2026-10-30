"use client";

import { useState } from "react";

const sectors = [
  {
    id: "hardware",
    label: "Quincaillerie",
    description: "Des unités de vente comme la pièce, le sac ou le mètre, avec un stock qui suit chaque opération.",
  },
  {
    id: "phones",
    label: "Téléphones",
    description: "Des produits et accessoires suivis par quantité, avec un repère IMEI facultatif quand il est utile.",
  },
  {
    id: "general",
    label: "Boutique générale",
    description: "Des catégories flexibles pour garder des produits variés dans un catalogue commun.",
  },
  {
    id: "clothing",
    label: "Vêtements",
    description: "Des variantes de taille et de couleur rattachées au même article lorsque le commerce en a besoin.",
  },
] as const;

export function SectorPicker() {
  const [selected, setSelected] = useState<(typeof sectors)[number]["id"]>("hardware");
  const current = sectors.find((sector) => sector.id === selected) ?? sectors[0];

  return (
    <div className="sector-picker">
      <div className="sector-options" role="group" aria-label="Choisir un secteur d’activité">
        {sectors.map((sector) => (
          <button
            aria-pressed={selected === sector.id}
            className={selected === sector.id ? "sector-option is-selected" : "sector-option"}
            key={sector.id}
            onClick={() => setSelected(sector.id)}
            type="button"
          >
            <span>{sector.label}</span><span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <p className="sector-description" key={current.id}>{current.description}</p>
    </div>
  );
}
