import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BackToTop } from "../../components/BackToTop";
import { clipToCounties, estimatedExit, type CountyData, type LatLon } from "./transportGeometry";
import { sourceLabel, TRANSPORT_LINKS, validSnapshot, type Aircraft, type Train, type TransportSnapshot } from "./transportData";
import "./transport.css";

const timeFormat = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const numberFormat = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 });
const dateLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? timeFormat.format(new Date(value)) : "–";
type LayerKey = "aircraft" | "trains" | "roads";

function popup(title: string, details: string[]) {
  const container = document.createElement("div");
  container.className = "transport-popup";
  const heading = document.createElement("strong");
  heading.textContent = title;
  container.append(heading);
  for (const detail of details) {
    const line = document.createElement("span");
    line.textContent = detail;
    container.append(line);
  }
  return container;
}

function flightIcon(heading: number | null) {
  const knownDirection = heading !== null && Number.isFinite(heading);
  const rotation = knownDirection ? heading : 0;
  return L.divIcon({
    className: `transport-flight-icon${knownDirection ? "" : " transport-flight-icon--unknown"}`,
    html: `<svg viewBox="0 0 32 32" aria-hidden="true" style="transform:rotate(${rotation}deg)"><path d="M16 1.5c1.4 0 2 1.1 2 2.5v8.5l10.5 7v3L18 19.5V27l3 2v2l-5-1.5-5 1.5v-2l3-2v-7.5L3.5 22.5v-3l10.5-7V4c0-1.4.6-2.5 2-2.5Z"/></svg>${knownDirection ? "" : "<small>?</small>"}`,
    iconSize: [32, 32], iconAnchor: [16, 16],
  });
}

function planeDetails(aircraft: Aircraft) {
  return [
    aircraft.route ? `${aircraft.route.origin.name} → ${aircraft.route.destination.name}` : "Az indulási és érkezési repülőtér nem ismert.",
    aircraft.country || "Ismeretlen lajstromozási ország",
    aircraft.altitudeM === null ? "Magasság: nincs adat" : `Magasság: ${numberFormat.format(aircraft.altitudeM)} m`,
    aircraft.speedKmh === null ? "Sebesség: nincs adat" : `Sebesség: ${numberFormat.format(aircraft.speedKmh)} km/h`,
    `Pozíció: ${dateLabel(aircraft.seenAt)}`,
    (aircraft.trail?.length ?? 0) > 1 ? `Eddigi nyom: ${aircraft.trail?.length} mért pont` : "A mért útvonalhoz még kell egy következő pozíció.",
    aircraft.route ? "A cél felé rajzolt szakasz becslés, nem repülési terv." : "A szaggatott folytatás a jelenlegi irány becslése.",
  ];
}

function flightTitle(aircraft: Aircraft) {
  const number = aircraft.route?.flightNumber || aircraft.callsign || aircraft.id.toUpperCase();
  return aircraft.route ? `${aircraft.route.origin.city} → ${aircraft.route.destination.city} · ${number}` : `Útvonal nem ismert · ${number}`;
}

function trainTitle(train: Train) {
  return train.route ? `${train.route.origin} → ${train.route.destination} · ${train.label}` : `Útvonal nem ismert · ${train.label}`;
}

export function RegionalTransport() {
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const groups = useRef<Record<LayerKey, L.LayerGroup> | null>(null);
  const aircraftMarkers = useRef(new globalThis.Map<string, L.Marker>());
  const trainMarkers = useRef(new globalThis.Map<string, L.CircleMarker>());
  const railwayLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const [snapshot, setSnapshot] = useState<TransportSnapshot | null>(null);
  const [counties, setCounties] = useState<CountyData | null>(null);
  const [railwayCount, setRailwayCount] = useState(0);
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({ aircraft: true, trains: true, roads: false });
  const [boundaryError, setBoundaryError] = useState(false);

  useEffect(() => {
    if (!mapElement.current) return;
    const leafletMap = L.map(mapElement.current, { scrollWheelZoom: false, zoomControl: true }).setView([42.08, 23.42], 8);
    map.current = leafletMap;
    L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      subdomains: "abc", maxZoom: 18,
      attribution: 'Adatok &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> közreműködők · térkép &copy; <a href="https://www.openstreetmap.fr/">OSM France</a>',
    }).addTo(leafletMap);
    const layers = { aircraft: L.layerGroup().addTo(leafletMap), trains: L.layerGroup().addTo(leafletMap), roads: L.layerGroup().addTo(leafletMap) };
    groups.current = layers;
    railwayLayer.current = L.layerGroup().addTo(leafletMap);
    routeLayer.current = L.layerGroup().addTo(leafletMap);
    L.circleMarker([42.129, 23.25], { radius: 6, color: "#073d39", fillColor: "#e9aa20", fillOpacity: 1, weight: 2 })
      .bindTooltip("Pasztra", { permanent: true, direction: "top", className: "transport-place-label" }).addTo(leafletMap);
    for (const place of [
      { name: "Kjusztendil", lat: 42.2839, lon: 22.6911 },
      { name: "Blagoevgrad", lat: 42.0209, lon: 23.0943 },
    ]) {
      L.circleMarker([place.lat, place.lon], { radius: 4, color: "#073d39", fillColor: "#f9eed1", fillOpacity: 1, weight: 2 })
        .bindTooltip(place.name, { permanent: true, direction: "bottom", className: "transport-place-label" }).addTo(leafletMap);
    }
    const controller = new AbortController();
    void fetch(`${import.meta.env.BASE_URL}data/transport-oblasts.geojson`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((geojson: CountyData) => {
        if (controller.signal.aborted) return;
        setCounties(geojson);
        L.geoJSON(geojson, {
          style: (feature) => ({ color: feature?.properties?.id === "kyustendil" ? "#dc763a" : "#138f87", weight: 2.5, fillColor: feature?.properties?.id === "kyustendil" ? "#f0ae43" : "#51b0a1", fillOpacity: .13, dashArray: "8 5" }),
          onEachFeature: (feature, layer) => layer.bindTooltip(String(feature.properties?.name ?? "Megye"), { sticky: true }),
        }).addTo(leafletMap);
      }).catch(() => { if (!controller.signal.aborted) setBoundaryError(true); });
    void fetch(`${import.meta.env.BASE_URL}data/transport-railways.geojson`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((geojson: GeoJSON.FeatureCollection) => {
        if (controller.signal.aborted || !railwayLayer.current) return;
        const lines = geojson.features.find((feature) => feature.properties?.kind === "railways");
        if (lines?.geometry.type === "MultiLineString") setRailwayCount(lines.geometry.coordinates.length);
        L.geoJSON(geojson, {
          style: (feature) => feature?.properties?.kind === "station"
            ? { color: "#073d39", weight: 1, fillColor: "#f7e8bd", fillOpacity: .95 }
            : { color: "#dcae4d", weight: 2.5, opacity: .75 },
          pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 2.5 }),
          onEachFeature: (feature, layer) => { if (feature.properties?.kind === "station") layer.bindTooltip(String(feature.properties.name || "BDZ állomás")); },
        }).addTo(railwayLayer.current);
      }).catch(() => { if (!controller.signal.aborted) setRailwayCount(0); });
    const markers = aircraftMarkers.current;
    const trains = trainMarkers.current;
    return () => { controller.abort(); leafletMap.remove(); map.current = null; groups.current = null; railwayLayer.current = null; routeLayer.current = null; markers.clear(); trains.clear(); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setClock(Date.now());
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/transport-live.json?updated=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next: unknown = await response.json();
        if (!validSnapshot(next)) throw new Error("Érvénytelen közlekedési adat.");
        if (active) { setSnapshot(next); setError(""); }
      } catch {
        if (active) setError("A közlekedési adatgyűjtő még nem érhető el. Indítsd el helyben a transport:watch parancsot.");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const layers = groups.current;
    const leafletMap = map.current;
    if (!layers || !leafletMap) return;
    for (const key of ["aircraft", "trains", "roads"] as const) {
      layers[key].clearLayers();
      if (visible[key] && !leafletMap.hasLayer(layers[key])) layers[key].addTo(leafletMap);
      if (!visible[key] && leafletMap.hasLayer(layers[key])) leafletMap.removeLayer(layers[key]);
    }
    if (railwayLayer.current) {
      if (visible.trains && !leafletMap.hasLayer(railwayLayer.current)) railwayLayer.current.addTo(leafletMap);
      if (!visible.trains && leafletMap.hasLayer(railwayLayer.current)) leafletMap.removeLayer(railwayLayer.current);
    }
    aircraftMarkers.current.clear();
    if (visible.aircraft) for (const aircraft of snapshot?.aircraft ?? []) {
      if (!Number.isFinite(aircraft.latitude) || !Number.isFinite(aircraft.longitude)) continue;
      const marker = L.marker([aircraft.latitude, aircraft.longitude], { icon: flightIcon(aircraft.heading), title: aircraft.callsign || aircraft.id })
        .bindPopup(popup(flightTitle(aircraft), planeDetails(aircraft)))
        .on("click", () => setSelectedAircraftId(aircraft.id)).addTo(layers.aircraft);
      aircraftMarkers.current.set(aircraft.id, marker);
    }
    trainMarkers.current.clear();
    if (visible.trains) for (const train of snapshot?.trains ?? []) {
      if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) continue;
      const marker = L.circleMarker([train.latitude, train.longitude], { radius: 8, color: "#063832", fillColor: "#f5c451", fillOpacity: 1, weight: 2 })
        .bindPopup(popup(trainTitle(train), [`BDZ által közölt pozíció: ${dateLabel(train.seenAt)}`, train.tripId ? `Járat: ${train.tripId}` : "", train.delayMinutes == null ? "Késés: nincs adat" : `Késés: ${train.delayMinutes} perc`].filter(Boolean)))
        .on("click", () => setSelectedAircraftId(null)).addTo(layers.trains);
      trainMarkers.current.set(train.id, marker);
    }
    if (visible.roads) for (const road of snapshot?.roads ?? []) {
      if (!Number.isFinite(road.latitude) || !Number.isFinite(road.longitude)) continue;
      L.circleMarker([road.latitude, road.longitude], { radius: 9, color: "#063832", fillColor: "#efb02d", fillOpacity: 1, weight: 2 })
        .bindPopup(popup(road.title, [road.description || "Közúti esemény", `Frissítve: ${dateLabel(road.updatedAt)}`])).addTo(layers.roads);
    }
  }, [snapshot, visible]);

  useEffect(() => {
    const overlay = routeLayer.current;
    if (!overlay) return;
    overlay.clearLayers();
    const aircraft = snapshot?.aircraft.find((item) => item.id === selectedAircraftId);
    if (!aircraft || !visible.aircraft || !counties) return;
    const trail: LatLon[] = (aircraft.trail ?? []).map((point) => [point.latitude, point.longitude]);
    for (const segment of clipToCounties(trail, counties)) {
      L.polyline(segment, { color: "#23a79b", weight: 4, opacity: .95 }).addTo(overlay);
    }
    const start: LatLon = [aircraft.latitude, aircraft.longitude];
    const destination = aircraft.route ? [aircraft.route.destination.latitude, aircraft.route.destination.longitude] as LatLon : null;
    const end = estimatedExit(start, destination, aircraft.heading);
    if (end) for (const segment of clipToCounties([start, end], counties)) {
      L.polyline(segment, { color: "#f0b539", weight: 3, opacity: .95, dashArray: "7 7" }).addTo(overlay);
    }
  }, [counties, selectedAircraftId, snapshot, visible.aircraft]);

  const flightAge = snapshot?.sources.aircraft.updatedAt ? clock - Date.parse(snapshot.sources.aircraft.updatedAt) : Infinity;
  const flightStale = !Number.isFinite(flightAge) || flightAge > 15 * 60_000;
  const trainAge = snapshot?.sources.trains.updatedAt ? clock - Date.parse(snapshot.sources.trains.updatedAt) : Infinity;
  const trainStale = !Number.isFinite(trainAge) || trainAge > 15 * 60_000;
  const planes = snapshot?.aircraft ?? [];
  const trains = snapshot?.trains ?? [];
  const selectedFlight = planes.find((item) => item.id === selectedAircraftId);
  const toggle = (key: LayerKey) => setVisible((current) => ({ ...current, [key]: !current[key] }));
  const focusAircraft = (aircraft: Aircraft) => {
    setSelectedAircraftId(aircraft.id);
    map.current?.flyTo([aircraft.latitude, aircraft.longitude], Math.max(map.current.getZoom(), 9));
    aircraftMarkers.current.get(aircraft.id)?.openPopup();
  };
  const focusTrain = (train: Train) => {
    setSelectedAircraftId(null);
    map.current?.flyTo([train.latitude, train.longitude], Math.max(map.current.getZoom(), 9));
    trainMarkers.current.get(train.id)?.openPopup();
  };

  return <article className="regional-transport card" id="kozlekedes">
    <div className="section-header">
      <div className="section-header__lead">
        <div className="section-kicker"><p className="eyebrow">Közlekedés · Délnyugat-Bulgária</p><BackToTop /></div>
        <h2>Mi mozog a környéken?</h2>
        <p>Kjusztendil és Blagoevgrad megye · Pasztra körül</p>
      </div>
      <div className="transport-freshness-group" role="status">
        <div className="transport-freshness"><i className={!flightStale && snapshot?.sources.aircraft.status === "ok" ? "is-live" : ""} />
          <span>{sourceLabel(snapshot?.sources.aircraft, flightStale)}<small>Repülők: {dateLabel(snapshot?.sources.aircraft.updatedAt)}</small></span></div>
        <div className="transport-freshness"><i className={!trainStale && snapshot?.sources.trains.status === "ok" ? "is-live" : ""} />
          <span>{sourceLabel(snapshot?.sources.trains, trainStale)}<small>BDZ: {dateLabel(snapshot?.sources.trains.updatedAt)}</small></span></div>
      </div>
    </div>

    <div className="transport-layers" aria-label="Térképrétegek">
      {([ ["aircraft", "Repülők", planes.length], ["trains", "Vonatok", snapshot?.trains.length ?? 0], ["roads", "Úthelyzet", snapshot?.roads.length ?? 0] ] as const).map(([key, label, count]) =>
        <button key={key} type="button" aria-pressed={visible[key]} disabled={key === "roads" && snapshot?.sources[key].status === "unavailable"} onClick={() => toggle(key)} className={`transport-layers__button transport-layers__button--${key}`}>
          <span className="transport-layers__symbol" aria-hidden="true">{key === "aircraft" ? "✈" : key === "trains" ? "▰" : "!"}</span>
          <strong>{label}</strong><span>{key === "trains" ? `${count} vonat · ${railwayCount} vasúti szakasz` : snapshot?.sources[key].status === "unavailable" ? "nincs bekötve" : `${count} jelzés`}</span>
        </button>)}
      <span className="transport-layers__hint">A térkép görgő helyett a + / − gombbal nagyítható.</span>
    </div>

    <div className="transport-layout">
      <div className="transport-map" ref={mapElement} role="region" aria-label="Interaktív közlekedési térkép Kjusztendil és Blagoevgrad megyéről" />
      <aside className="transport-side">
        <p className="eyebrow">A kiválasztott körzet</p>
        <h3>Égi forgalom</h3>
        <strong className="transport-side__count">{planes.length}<small> repülő</small></strong>
        {error && <p className="transport-side__warning">{error}</p>}
        {snapshot?.sources.aircraft.status === "stale" && <p className="transport-side__warning">Az OpenSky most nem válaszol; a korábbi pozíciók láthatók.</p>}
        {!error && snapshot?.sources.aircraft.status === "ok" && flightStale && <p className="transport-side__warning">A repülőpozíciók elavultak. Ellenőrizd a helyi adatgyűjtőt.</p>}
        <div className="transport-side__list">
          {visible.aircraft && planes.length ? planes.slice(0, 12).map((plane) =>
            <button type="button" key={plane.id} onClick={() => focusAircraft(plane)}>
              <span><b>✈</b><strong>{flightTitle(plane)}</strong><small>{plane.country || "Ország nélkül"}</small></span>
              <em>{plane.altitudeM === null ? "–" : `${numberFormat.format(plane.altitudeM)} m`}</em>
            </button>) : <p>{visible.aircraft ? "Most nincs jelentett repülő ebben a körzetben." : "A repülőréteg ki van kapcsolva."}</p>}
        </div>
        {selectedFlight && visible.aircraft && <div className="transport-route-key"><span><i className="transport-route-key__past" />Mért repülőút</span><span><i className="transport-route-key__future" />Becsült folytatás</span></div>}
        <div className="transport-side__rail">
          <h3>BDZ-vonatok <small>{trains.length}</small></h3>
          {snapshot?.sources.trains.status === "stale" && <p className="transport-side__warning">A vonatpozíciók nem frissek; az utolsó ismert állapot látható.</p>}
          <div className="transport-side__list transport-side__list--trains">
            {visible.trains && trains.length ? trains.map((train) => <button type="button" key={train.id} onClick={() => focusTrain(train)}>
              <span><b>▰</b><strong>{trainTitle(train)}</strong><small>BDZ · {dateLabel(train.seenAt)}</small></span><em>↗</em>
            </button>) : <p>{visible.trains ? "Most nincs jelentett vonat a két megyében." : "A vonatréteg ki van kapcsolva."}</p>}
          </div>
        </div>
        <div className="transport-side__pending">
          <strong>Adatforrások</strong>
          <p>A vasútvonalak a BDZ menetrendi alakzatai, a járműpontok a hivatalos GTFS-RT adatok. Közúti élő eseményfolyam még nincs bekötve.</p>
          <a href={TRANSPORT_LINKS.bdz} target="_blank" rel="noreferrer">BDZ élő radar ↗</a>
          <a href={TRANSPORT_LINKS.roads} target="_blank" rel="noreferrer">Közúti adatportál ↗</a>
        </div>
      </aside>
    </div>
    <p className="transport-footnote">{boundaryError ? "A megyehatárok most nem tölthetők be. " : "Szaggatott körvonal: megyehatár. "}Térkép és határok: <a href={TRANSPORT_LINKS.osm} target="_blank" rel="noreferrer">OpenStreetMap</a>. Vasút és vonatok: <a href={TRANSPORT_LINKS.bdzNap} target="_blank" rel="noreferrer">BDZ / bolgár NAP</a>. Repülőpozíció: <a href={TRANSPORT_LINKS.opensky} target="_blank" rel="noreferrer">OpenSky</a>; indulás és cél: <a href="https://www.adsbdb.com/" target="_blank" rel="noreferrer">ADSBDB</a>. A múltbeli repülővonal csak a helyi adatgyűjtés óta mért pontokat köti össze; a jövőbeli szakasz egyenes iránybecslés, nem hivatalos útvonal.</p>
  </article>;
}
