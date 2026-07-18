const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const CSV_URL = 'https://docs.google.com/spreadsheets/d/11FiAPk3q25__C_IA94tgPAGEss1pQwSs/export?format=csv&gid=1944873028';
const CACHE_FILE = path.join(__dirname, 'cache.json');

// In-memory cache loaded from disk
let geocodeCache = {};
if (fs.existsSync(CACHE_FILE)) {
    try {
        geocodeCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } catch (err) {
        console.error("Erro ao ler o cache:", err);
    }
}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(geocodeCache, null, 2));
}

function cleanAddress(rawAddress) {
    if (!rawAddress) return '';
    // Remove tudo entre parênteses
    let clean = rawAddress.replace(/\([^)]*\)/g, '').trim();
    
    // Adiciona a cidade se não houver indicativo claro (isso ajuda muito o Nominatim)
    // A maioria dos endereços parecem ser de Porto Alegre
    return `${clean}, Porto Alegre, RS, Brasil`;
}

// Fila de geocodificação para respeitar limite de 1 req/s do Nominatim
let geocodeQueue = [];
let isGeocoding = false;

async function processGeocodeQueue() {
    if (isGeocoding || geocodeQueue.length === 0) return;
    isGeocoding = true;

    while (geocodeQueue.length > 0) {
        const rawAddress = geocodeQueue.shift();
        
        // Se já foi cacheado no meio tempo, pula
        if (geocodeCache[rawAddress]) {
            continue;
        }

        const queryAddress = cleanAddress(rawAddress);
        console.log(`Geocodificando: ${queryAddress}`);

        try {
            const response = await axios.get('https://nominatim.openstreetmap.org/search', {
                params: {
                    q: queryAddress,
                    format: 'json',
                    limit: 1
                },
                headers: {
                    'User-Agent': 'DefesaCivilPOAMapa/1.0 (contato@portoalegre.rs.gov.br)'
                }
            });

            if (response.data && response.data.length > 0) {
                const location = response.data[0];
                geocodeCache[rawAddress] = {
                    lat: parseFloat(location.lat),
                    lng: parseFloat(location.lon),
                    found: true
                };
            } else {
                console.log(`Não encontrado: ${queryAddress}`);
                geocodeCache[rawAddress] = { found: false };
            }
            saveCache();
        } catch (error) {
            console.error(`Erro ao geocodificar ${queryAddress}:`, error.message);
            // Em caso de erro (ex: limite de taxa), devolve pra fila e espera mais tempo
            geocodeQueue.unshift(rawAddress);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Aguarda 1 segundo entre requisições (obrigatório pelo Nominatim)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    isGeocoding = false;
}

app.get('/api/data', async (req, res) => {
    try {
        // 1. Baixar o CSV mais recente
        const response = await axios.get(CSV_URL);
        const csvData = response.data;

        // 2. Parsear o CSV (ignorando a primeira linha de meta se necessário)
        const records = parse(csvData, {
            skip_empty_lines: true,
            relax_quotes: true
        });

        // Procurar qual linha tem os cabeçalhos
        let headerIndex = -1;
        let enderecoColIndex = -1;
        let dataColIndex = -1;
        let ocorrenciaColIndex = -1;
        let orgaoColIndex = -1;
        
        for (let i = 0; i < Math.min(20, records.length); i++) {
            const row = records[i].map(c => c ? c.toUpperCase() : '');
            
            const idxEnd = row.findIndex(col => col.includes('ENDEREÇO'));
            if (idxEnd !== -1) {
                headerIndex = i;
                enderecoColIndex = idxEnd;
                dataColIndex = row.findIndex(col => col.includes('DATA'));
                ocorrenciaColIndex = row.findIndex(col => col.includes('OCORRÊNCIA'));
                orgaoColIndex = row.findIndex(col => col.includes('ORG') || col.includes('ÓRG'));
                break;
            }
        }

        if (enderecoColIndex === -1) {
            return res.status(500).json({ error: "Coluna de ENDEREÇO não encontrada no CSV." });
        }

        let newAddressesFound = 0;
        let result = [];

        // 3. Processar linhas
        for (let i = headerIndex + 1; i < records.length; i++) {
            const rawAddress = records[i][enderecoColIndex];
            if (!rawAddress || rawAddress.trim() === '') continue;

            const addressStr = String(rawAddress).trim();
            const dataStr = dataColIndex !== -1 ? String(records[i][dataColIndex]).trim() : '';
            const ocorrenciaStr = ocorrenciaColIndex !== -1 ? String(records[i][ocorrenciaColIndex]).trim() : 'Outros';
            const orgaoStr = orgaoColIndex !== -1 && records[i][orgaoColIndex] ? String(records[i][orgaoColIndex]).trim() : 'Defesa Civil'; // Mock default

            if (geocodeCache[addressStr]) {
                if (geocodeCache[addressStr].found) {
                    result.push({
                        raw: addressStr,
                        lat: geocodeCache[addressStr].lat,
                        lng: geocodeCache[addressStr].lng,
                        date: dataStr,
                        natureza: ocorrenciaStr,
                        orgao: orgaoStr,
                        row: i + 1
                    });
                }
            } else {
                // Adiciona na fila se não estiver no cache e não estiver na fila
                if (!geocodeQueue.includes(addressStr)) {
                    geocodeQueue.push(addressStr);
                    newAddressesFound++;
                }
            }
        }

        // Inicia processamento da fila em segundo plano se houver itens
        if (newAddressesFound > 0) {
            processGeocodeQueue();
        }

        res.json({
            status: 'success',
            geocodingQueueLength: geocodeQueue.length,
            locations: result
        });

    } catch (error) {
        console.error("Erro ao processar dados:", error);
        res.status(500).json({ error: "Falha ao processar os dados da planilha." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
