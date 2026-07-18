// Inicializa o mapa centralizado em Porto Alegre
const map = L.map('map', {
    zoomControl: false,
    preferCanvas: true // Renderiza vetores em Canvas (corrige offset no html2canvas/PDF)
}).setView([-30.0346, -51.2177], 12);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Camadas Base
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
    crossOrigin: true
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri',
    maxZoom: 19,
    crossOrigin: true
});

darkLayer.addTo(map);

let markersLayer = L.layerGroup().addTo(map);
let heatLayer = null;
let rawData = []; // Todos os dados originais
let currentData = []; // Dados após filtros
let isHeatmapActive = false;

// Modo de Agrupamento
const colorModeSelect = document.getElementById('color-mode');
let colorMode = 'natureza';

// Estado dos Filtros de Natureza/Órgão
let activeNaturezas = new Set();
let naturezasCounts = new Map();

// Elementos da UI
const btnMarkers = document.getElementById('btn-markers');
const btnHeatmap = document.getElementById('btn-heatmap');
const btnSatellite = document.getElementById('btn-satellite');
const countMapped = document.getElementById('count-mapped');
const statusText = document.getElementById('status-text');
const queueBox = document.getElementById('queue-box');
const countQueue = document.getElementById('count-queue');

const dateStart = document.getElementById('date-start');
const dateEnd = document.getElementById('date-end');
const btnExport = document.getElementById('btn-export');
const legendItems = document.getElementById('legend-items');

// Carregar logo para PDF
let logoBase64 = null;
function loadLogo() {
    fetch('logo.png')
        .then(res => res.blob())
        .then(blob => {
            const reader = new FileReader();
            reader.onloadend = () => {
                logoBase64 = reader.result;
            };
            reader.readAsDataURL(blob);
        });
}
loadLogo();

// Paleta de Cores
const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', 
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', 
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#f43f5e'
];
let naturezasMap = new Map();

// Controles
btnMarkers.addEventListener('click', () => {
    isHeatmapActive = false;
    btnMarkers.classList.add('active');
    btnHeatmap.classList.remove('active');
    renderData();
});

btnHeatmap.addEventListener('click', () => {
    isHeatmapActive = true;
    btnHeatmap.classList.add('active');
    btnMarkers.classList.remove('active');
    renderData();
});

btnSatellite.addEventListener('click', () => {
    if (map.hasLayer(satelliteLayer)) {
        map.removeLayer(satelliteLayer);
        darkLayer.addTo(map);
        btnSatellite.classList.remove('active');
    } else {
        map.removeLayer(darkLayer);
        satelliteLayer.addTo(map);
        btnSatellite.classList.add('active');
    }
});

function parseDateBR(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]); 
    }
    return null;
}

function filterData() {
    let start = dateStart.value ? new Date(dateStart.value) : null;
    let end = dateEnd.value ? new Date(dateEnd.value) : null;
    
    if (start) start.setHours(0,0,0,0);
    if (end) end.setHours(23,59,59,999);

    // Primeiro, conta as naturezas baseadas APENAS no filtro de data, para exibir as quantidades na legenda corretamente
    naturezasCounts.clear();
    
    const dateFilteredData = rawData.filter(loc => {
        if (start || end) {
            const locDate = parseDateBR(loc.date);
            if (locDate) {
                if (start && locDate < start) return false;
                if (end && locDate > end) return false;
            }
        }
        return true;
    });

    dateFilteredData.forEach(loc => {
        const key = colorMode === 'natureza' ? loc.natureza : loc.orgao;
        naturezasCounts.set(key, (naturezasCounts.get(key) || 0) + 1);
    });

    // Agora filtra os marcadores finais pela chave selecionada também
    currentData = dateFilteredData.filter(loc => {
        const key = colorMode === 'natureza' ? loc.natureza : loc.orgao;
        return activeNaturezas.has(key);
    });

    countMapped.textContent = currentData.length;
    updateLegend();
    renderData();
}

dateStart.addEventListener('change', filterData);
dateEnd.addEventListener('change', filterData);
colorModeSelect.addEventListener('change', (e) => {
    colorMode = e.target.value;
    
    // Recalcula cores para o novo modo
    let colorIndex = 0;
    naturezasMap.clear();
    activeNaturezas.clear();
    
    rawData.forEach(loc => {
        const key = colorMode === 'natureza' ? loc.natureza : loc.orgao;
        if (!naturezasMap.has(key)) {
            // Se for órgão e for Defesa Civil, tenta um laranja padrão, senão pega do array
            if (colorMode === 'orgao' && key.toUpperCase().includes('DEFESA CIVIL')) {
                naturezasMap.set(key, '#f97316');
            } else {
                naturezasMap.set(key, colors[colorIndex % colors.length]);
                colorIndex++;
            }
        }
        activeNaturezas.add(key);
    });

    filterData();
});

function getCustomIcon(color) {
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="30px" height="30px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
    const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon);
    return L.icon({
        iconUrl: url,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });
}

function updateLegend() {
    legendItems.innerHTML = '';
    
    // Sort naturezas by name
    const sortedNaturezas = Array.from(naturezasMap.keys()).sort();
    
    sortedNaturezas.forEach(name => {
        const color = naturezasMap.get(name);
        const count = naturezasCounts.get(name) || 0;
        
        // Hide if count is 0 based on date filter (optional, but good UX)
        if (count === 0) return;

        const item = document.createElement('label');
        item.className = 'legend-item';
        
        const isChecked = activeNaturezas.has(name) ? 'checked' : '';

        item.innerHTML = `
            <input type="checkbox" class="legend-checkbox" value="${name}" ${isChecked}>
            <div class="legend-color" style="background-color: ${color}"></div> 
            <span class="legend-name" title="${name}">${name}</span>
            <span class="legend-count">${count}</span>
        `;
        
        // Evento do checkbox
        const cb = item.querySelector('input');
        cb.addEventListener('change', (e) => {
            if (e.target.checked) {
                activeNaturezas.add(name);
            } else {
                activeNaturezas.delete(name);
            }
            filterData(); // re-aplica filtros
        });

        legendItems.appendChild(item);
    });
}

function renderData() {
    markersLayer.clearLayers();
    if (heatLayer) map.removeLayer(heatLayer);
    
    if (currentData.length === 0) return;

    if (isHeatmapActive) {
        const heatPoints = currentData.map(loc => [loc.lat, loc.lng, 1]);
        heatLayer = L.heatLayer(heatPoints, {
            radius: 20, blur: 25, maxZoom: 13,
            gradient: {0.2: 'blue', 0.4: 'cyan', 0.6: 'lime', 0.8: 'yellow', 1.0: 'red'}
        }).addTo(map);
    } else {
        currentData.forEach(loc => {
            const key = colorMode === 'natureza' ? loc.natureza : loc.orgao;
            const color = naturezasMap.get(key) || '#ffffff';
            const marker = L.marker([loc.lat, loc.lng], { icon: getCustomIcon(color) });
            
            marker.bindPopup(`
                <div style="font-family: 'Inter', sans-serif;">
                    <strong style="color: ${color};">${key}</strong><br>
                    <span style="font-size: 13px;"><b>Data:</b> ${loc.date}</span><br>
                    <span style="font-size: 13px;"><b>Endereço:</b> ${loc.raw}</span><br>
                    ${colorMode === 'natureza' ? `<span style="font-size: 13px;"><b>Orgão:</b> ${loc.orgao}</span><br>` : `<span style="font-size: 13px;"><b>Natureza:</b> ${loc.natureza}</span><br>`}
                    <span style="font-size: 12px; color: #888;">Linha Planilha: ${loc.row}</span>
                </div>
            `);
            markersLayer.addLayer(marker);
        });
    }
}

async function fetchData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();

        if (data.status === 'success') {
            rawData = data.locations;
            
            // Atribui cores únicas e ativa todas inicialmente
            let colorIndex = 0;
            const tempNaturezas = new Set();
            
            rawData.forEach(loc => {
                const key = colorMode === 'natureza' ? loc.natureza : loc.orgao;
                if (!naturezasMap.has(key)) {
                    naturezasMap.set(key, colors[colorIndex % colors.length]);
                    colorIndex++;
                }
                tempNaturezas.add(key);
            });
            
            // Só adiciona ao activeNaturezas na primeira carga
            if (activeNaturezas.size === 0) {
                tempNaturezas.forEach(n => activeNaturezas.add(n));
            }

            filterData(); // Applica os filtros e renderiza

            if (data.geocodingQueueLength > 0) {
                statusText.textContent = "Geocodificando novos endereços...";
                queueBox.style.display = 'flex';
                countQueue.textContent = data.geocodingQueueLength;
                setTimeout(fetchData, 5000);
            } else {
                statusText.textContent = "Dados atualizados com sucesso.";
                queueBox.style.display = 'none';
            }
        }
    } catch (error) {
        console.error("Erro ao buscar dados:", error);
        statusText.textContent = "Erro ao conectar com servidor.";
    }
}

// Exportar PDF
btnExport.addEventListener('click', async () => {
    if (currentData.length === 0) {
        alert("Nenhum dado para exportar.");
        return;
    }

    // Feedback visual
    const originalText = btnExport.innerText;
    btnExport.innerText = "Capturando Mapa...";
    btnExport.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('portrait'); // Retrato

        // 1. Adiciona a Logo
        if (logoBase64) {
            doc.addImage(logoBase64, 'PNG', 14, 10, 30, 30);
        }

        // 2. Título
        doc.setFontSize(18);
        doc.text("Relatório de Ocorrências - Defesa Civil", 50, 20);
        
        // Subtítulo com período
        doc.setFontSize(11);
        const startStr = dateStart.value ? new Date(dateStart.value).toLocaleDateString('pt-BR') : 'Início';
        const endStr = dateEnd.value ? new Date(dateEnd.value).toLocaleDateString('pt-BR') : 'Final';
        doc.text(`Período: ${startStr} a ${endStr}`, 50, 28);
        doc.text(`Total de ocorrências visíveis: ${currentData.length}`, 50, 34);

        // 3. Naturezas Ativas e Quantidades (com cores)
        let yPos = 45;
        doc.setFontSize(12);
        doc.text("Naturezas Ativas:", 14, yPos);
        yPos += 7;
        doc.setFontSize(10);
        
        const sortedNaturezas = Array.from(naturezasMap.keys()).sort();
        sortedNaturezas.forEach(name => {
            if (activeNaturezas.has(name)) {
                const count = naturezasCounts.get(name) || 0;
                if (count > 0) {
                    if (!isHeatmapActive) {
                        const colorHex = naturezasMap.get(name);
                        
                        // Desenha o quadradinho de cor da legenda
                        doc.setFillColor(colorHex);
                        doc.rect(14, yPos - 3, 3, 3, 'F'); // x, y, width, height, 'F' (fill)
                        
                        // Escreve o texto com espaçamento para o quadrado
                        doc.text(`${name}: ${count}`, 20, yPos);
                    } else {
                        // Sem quadrado de cor no modo Mapa de Calor
                        doc.text(`- ${name}: ${count}`, 14, yPos);
                    }
                    yPos += 5;
                }
            }
        });

        // 4. Capturar o Mapa
        yPos += 5;
        doc.text("Visualização do Mapa:", 14, yPos);
        yPos += 5;

        // Tira print do mapa (ignora a UI flutuante do html)
        const mapElement = document.getElementById('map');
        const canvas = await html2canvas(mapElement, {
            useCORS: true,
            allowTaint: false,
            ignoreElements: (el) => el.id === 'ui-container' || el.id === 'legend-container'
        });

        const mapImgData = canvas.toDataURL('image/png');
        
        // Calcula altura proporcional (Max width 180mm)
        const imgWidth = 182;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        // Se a imagem não couber na página atual, vai pra próxima
        if (yPos + imgHeight > 280) {
            doc.addPage();
            yPos = 20;
        }

        doc.addImage(mapImgData, 'PNG', 14, yPos, imgWidth, imgHeight);
        yPos += imgHeight + 10;

        // 5. Tabela de dados
        const tableData = currentData.map(loc => [
            loc.date,
            loc.natureza,
            loc.raw
        ]);

        doc.autoTable({
            startY: yPos,
            head: [['Data', 'Natureza', 'Endereço']],
            body: tableData,
            theme: 'striped',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [37, 99, 235] }
        });

        // 6. Salva o arquivo
        const safeStart = dateStart.value || 'inicio';
        const safeEnd = dateEnd.value || 'fim';
        doc.save(`Relatorio_Defesa_Civil_${safeStart}_a_${safeEnd}.pdf`);

    } catch (err) {
        console.error(err);
        alert("Erro ao exportar PDF.");
    } finally {
        btnExport.innerText = originalText;
        btnExport.disabled = false;
    }
});

// Inicializa a primeira busca
fetchData();

// Importação de Shapefile (.zip)
const shpUpload = document.getElementById('shp-upload');
const shpColor = document.getElementById('shp-color');
const shpFill = document.getElementById('shp-fill');
let customShpLayer = null;

shpUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const buffer = event.target.result;
        
        // Remove camada anterior se existir
        if (customShpLayer) {
            map.removeLayer(customShpLayer);
        }

        shp(buffer).then(function(geojson) {
            customShpLayer = L.geoJSON(geojson, {
                style: function() {
                    return {
                        color: shpColor.value,
                        weight: 2,
                        fillColor: shpColor.value,
                        fillOpacity: shpFill.checked ? 0.65 : 0.0
                    };
                },
                onEachFeature: function (feature, layer) {
                    if (feature.properties) {
                        let popupContent = '<div style="max-height: 200px; overflow-y: auto;"><b>Detalhes:</b><br>';
                        for (let key in feature.properties) {
                            popupContent += `<b>${key}:</b> ${feature.properties[key]}<br>`;
                        }
                        popupContent += '</div>';
                        layer.bindPopup(popupContent);
                    }
                }
            }).addTo(map);
            
            // Foca o mapa na nova camada importada
            map.fitBounds(customShpLayer.getBounds());
            
        }).catch(function(error) {
            console.error("Erro ao carregar Shapefile:", error);
            alert("Erro ao processar o Shapefile. Certifique-se de enviar um .zip válido contendo arquivos .shp, .shx e .dbf.");
        });
    };
    reader.readAsArrayBuffer(file);
});

// Alterar cor do shapefile dinamicamente
shpColor.addEventListener('input', function(e) {
    if (customShpLayer) {
        customShpLayer.setStyle({
            color: e.target.value,
            fillColor: e.target.value
        });
    }
});

// Alterar preenchimento do shapefile dinamicamente
shpFill.addEventListener('change', function(e) {
    if (customShpLayer) {
        customShpLayer.setStyle({
            fillOpacity: e.target.checked ? 0.65 : 0.0
        });
    }
});
