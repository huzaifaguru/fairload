import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { BINS, binOf, pct, num } from './format.js';

// Leaflet is driven directly so the map is not rebuilt each time a plan changes.
export default function MapView({ data, cov, selected, onSelect, routes }) {
  const box = useRef(null), map = useRef(null), layer = useRef(null);

  useEffect(() => {
    const m = L.map(box.current, { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 14, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  useEffect(() => {
    const pts = [...data.zips.map(z => [z.lat, z.lng]), ...data.hubs.map(h => [h.lat, h.lng])];
    map.current.fitBounds(pts, { padding: [24, 24] });
  }, [data]);

  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const maxPoor = Math.max(...data.zips.map(z => z.poor));
    (routes ?? []).forEach(r => {
      L.polyline([[r.from.lat, r.from.lng], [r.to.lat, r.to.lng]], { color: '#17291F', weight: Math.max(1.5, Math.min(7, r.lb / 400)), opacity: 0.65, interactive: false }).addTo(g);
    });
    data.zips.forEach((z, i) => {
      const c = cov?.[i] ?? 0, bin = binOf(c);
      const mark = L.circleMarker([z.lat, z.lng], {
        radius: 5 + 15 * Math.sqrt(z.poor / maxPoor), color: i === selected ? '#17291F' : '#fff', weight: i === selected ? 3 : 1.5,
        fillColor: cov ? bin.color : '#9AA8A0', fillOpacity: 0.9,
      }).addTo(g);
      mark.bindTooltip(`<b>${z.zip} ${z.city}</b><br>${cov ? pct(c, 0) + ' of need met<br>' : ''}${num(z.poor)} people in poverty, ${z.sites} site${z.sites === 1 ? '' : 's'}`);
      mark.on('click', () => onSelect(i));
    });
    data.hubs.forEach(h => {
      const icon = L.divIcon({ className: 'hub-icon', html: `<span class="hub-diamond"></span><span class="hub-name">${h.name}</span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
      L.marker([h.lat, h.lng], { icon, title: `${h.name} hub (approximate location)`, keyboard: false }).addTo(g);
    });
  }, [data, cov, selected, routes, onSelect]);

  return (
    <div className="map-wrap">
      <div ref={box} className="map" role="application" aria-label="Map of Delaware ZIP codes colored by share of need met" />
      <div className="legend" aria-label="Map legend">
        <b>Need met</b>
        {BINS.map(b => <span key={b.label}><i style={{ background: b.color }} />{b.label}</span>)}
        <span><i className="dia" />Hub</span>
        <span className="muted">Dot size: people in poverty</span>
      </div>
    </div>
  );
}
