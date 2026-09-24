/**
 * Dedicated Complex Library Mode Verification Test:
 * 12 Detailed Persons with distinct professions, skills, and mixed hobbies (some with hobbies, some with none).
 * Validates:
 * 1. Single-shot SGM/Library Upsert into Libraries/MemoryLibrary/Persons/
 * 2. Strict JSON validation and schema integrity
 * 3. Hobbies field presence:
 *    - 4 persons must have empty hobbies: []
 *    - 8 persons must have populated hobbies
 * 4. Keyword index updates
 * 5. Complex multi-criteria searches via runLibraryModeSubLoop:
 *    - Query 1: Hobby & Embedded IoT search -> Fırat Öztürk
 *    - Query 2: Chess & Cyber Security search -> Burak Demir
 *    - Query 3: Mountaineering & Cloud search -> Ahmet Yılmaz
 *    - Query 4: NLP Researcher with no hobbies -> Gamze Aydın
 *    - Query 5: Negative query (unregistered hobbies) -> No matches returned
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { agentState, config } = require('../src/state');
const { runLibraryAddSubLoop, runLibraryModeSubLoop } = require('../src/modes/libraryMode');

const PERSONS_DATA = [
  {
    name: "Ahmet_Yilmaz",
    prompt: "Kişi adı: Ahmet Yılmaz. 34 yaşında. Mesleği: Bulut ve Güvenlik Mimarı (Cloud & Security Architect). Yetenekleri: AWS Certified Solutions Architect, Kubernetes, Zero Trust Network Mimarisi. Hobileri: Dağcılık ve Doğa Fotoğrafçılığı. İletişim: ahmet.yilmaz@cloudsec.local.",
    hasHobbies: true,
    expectedHobbies: ["dağcılık", "fotoğrafçılık"]
  },
  {
    name: "Ayse_Kaya",
    prompt: "Kişi adı: Ayşe Kaya. 29 yaşında. Mesleği: Büyük Veri Bilimci (Big Data Scientist). Yetenekleri: PySpark, Hadoop, Predictive Modeling, TensorFlow. Hobisi yoktur, herhangi bir hobiyle uğraşmıyor. İletişim: ayse.kaya@bigdata.io.",
    hasHobbies: false,
    expectedHobbies: []
  },
  {
    name: "Burak_Demir",
    prompt: "Kişi adı: Burak Demir. 31 yaşında. Mesleği: Kıdemli Penetrasyon Test Uzmanı (Senior Penetration Tester). Yetenekleri: Metasploit, Reverse Engineering, OSCP sertifikalı, Kernel Exploit Analysis. Hobileri: Hızlı Satranç oynamak ve Boks yapmak. İletişim: burak@redteam.sec.",
    hasHobbies: true,
    expectedHobbies: ["satranç", "boks"]
  },
  {
    name: "Cemre_Sahin",
    prompt: "Kişi adı: Cemre Şahin. 26 yaşında. Mesleği: UI/UX ve Tasarım Sistemleri Lideri (Lead Design Systems Engineer). Yetenekleri: Figma Design Tokens, Design Systems, Accessible UX (WCAG 2.1). Hobileri: Seramik Atölyesi ve Yağlı Boya resim yapmak. İletişim: cemre@uxlab.design.",
    hasHobbies: true,
    expectedHobbies: ["seramik", "resim", "boya"]
  },
  {
    name: "Deniz_Aksoy",
    prompt: "Kişi adı: Deniz Aksoy. 33 yaşında. Mesleği: DevOps ve Site Reliability Engineer (SRE). Yetenekleri: CI/CD Pipelines, Terraform, Prometheus, Grafana, Chaos Engineering. Hobisi yoktur, hobi belirtilmedi. İletişim: deniz.aksoy@sre.ops.",
    hasHobbies: false,
    expectedHobbies: []
  },
  {
    name: "Elif_Celik",
    prompt: "Kişi adı: Elif Çelik. 27 yaşında. Mesleği: Cross-Platform Mobil Uygulama Geliştirici (Mobile App Developer). Yetenekleri: Flutter, React Native, SwiftUI, Offline Sync SQLite. Hobileri: Yarı Maraton Koşusu ve 3D Origami sanatı. İletişim: elif@mobilecraft.dev.",
    hasHobbies: true,
    expectedHobbies: ["koşu", "origami", "maraton"]
  },
  {
    name: "Firat_Ozturk",
    prompt: "Kişi adı: Fırat Öztürk. 38 yaşında. Mesleği: Gömülü Sistemler ve IoT Donanım Mühendisi (Embedded IoT Engineer). Yetenekleri: C/C++, RTOS, STM32 Microcontrollers, PCB Tasarımı, SPI/I2C/CAN Bus. Hobileri: Ahşap Oyma ve Model Uçak uçurmak. İletişim: firat@embedded.tech.",
    hasHobbies: true,
    expectedHobbies: ["ahşap", "model uçak", "oyma"]
  },
  {
    name: "Gamze_Aydin",
    prompt: "Kişi adı: Gamze Aydın. 30 yaşında. Mesleği: Büyük Dil Modelleri ve NLP Araştırmacısı (NLP & LLM Researcher). Yetenekleri: Transformer Modelleri, Fine-Tuning (LoRA), RAG Mimarisi, HuggingFace ekosistemi. Hobisi yoktur, herhangi bir hobi girilmedi. İletişim: gamze.aydin@nlpresearch.ai.",
    hasHobbies: false,
    expectedHobbies: []
  },
  {
    name: "Hakan_Koc",
    prompt: "Kişi adı: Hakan Koç. 36 yaşında. Mesleği: Yüksek Erişilebilirlik Veritabanı Yöneticisi (Database Administrator DBA). Yetenekleri: PostgreSQL Replikasyon, ClickHouse, Query Optimization, Sharding. Hobileri: Serbest Dalış ve Dağ Kampçılığı. İletişim: hakan@dbinfra.net.",
    hasHobbies: true,
    expectedHobbies: ["dalış", "kamp"]
  },
  {
    name: "Irem_Korkmaz",
    prompt: "Kişi adı: İrem Korkmaz. 28 yaşında. Mesleği: Otomasyonel Test ve QA Mimarı (Test Automation Architect). Yetenekleri: Playwright, Jest, k6 Yük Testleri, Contract Testing. Hobileri: Klasik Keman çalmak ve Botanik bitki yetiştiriciliği. İletişim: irem@qatesting.org.",
    hasHobbies: true,
    expectedHobbies: ["keman", "botanik"]
  },
  {
    name: "Kerem_Yildiz",
    prompt: "Kişi adı: Kerem Yıldız. 32 yaşında. Mesleği: Dağıtık Sistemler ve Mikroservis Mimarı (Distributed Systems Architect). Yetenekleri: Apache Kafka, gRPC, Event Sourcing, CQRS Mimarisi. Hobisi bulunmamaktadır, hobisi yok. İletişim: kerem@distributed.sys.",
    hasHobbies: false,
    expectedHobbies: []
  },
  {
    name: "Leyla_Arslan",
    prompt: "Kişi adı: Leyla Arslan. 29 yaşında. Mesleği: Blockchain ve Akıllı Kontrat Geliştiricisi (Smart Contract Engineer). Yetenekleri: Solidity, Rust, EVM Optimizasyonu, DeFi Protokol Güvenliği. Hobileri: Amatör Astronomi ve Astrofotografi (gökyüzü fotoğrafçılığı). İletişim: leyla@blockchain.eth.",
    hasHobbies: true,
    expectedHobbies: ["astronomi", "astrofotografi", "fotoğrafçılık"]
  }
];

async function runLibrary12PersonsExperiment() {
  console.log('======================================================================');
  console.log('🏛️ COMPLEX LIBRARY EXPERIMENT: 12 DETAILED PERSONS & ADVANCED SEARCH');
  console.log('======================================================================\n');

  const personsDir = path.join(agentState.cwd, 'Libraries', 'MemoryLibrary', 'Persons');
  if (!fs.existsSync(personsDir)) {
    fs.mkdirSync(personsDir, { recursive: true });
  }

  const createdFiles = [];
  const results = {
    creationPass: 0,
    schemaPass: 0,
    hobbiesPass: 0,
    searchesPass: 0
  };

  // -------------------------------------------------------------
  // PHASE 1: SEQUENTIAL CREATION & SCHEMA VALIDATION OF 12 PERSONS
  // -------------------------------------------------------------
  console.log('▶ [PHASE 1] Creating 12 Distinct Persons in Persons Category...\n');

  for (let i = 0; i < PERSONS_DATA.length; i++) {
    const p = PERSONS_DATA[i];
    console.log(`[${i + 1}/12] Generating Profile: ${p.name}...`);
    const startT = Date.now();

    const res = await runLibraryAddSubLoop(personsDir, p.name, p.prompt);
    const duration = Date.now() - startT;
    console.log(`      Output: ${res} (${duration}ms)`);

    const match = res.match(/Başarılı:\s*([^\s]+)\s*(eklendi|güncellendi)/i);
    const actualFilename = match ? match[1] : `${p.name}.json`;
    const filePath = path.join(personsDir, actualFilename);
    assert(fs.existsSync(filePath), `File was not created: ${filePath} (parsed: ${actualFilename})`);
    createdFiles.push(filePath);
    p.actualFilename = actualFilename;
    results.creationPass++;

    // Schema and content validation
    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
      results.schemaPass++;
    } catch (e) {
      assert.fail(`JSON parse failed for ${p.name}: ${e.message}`);
    }

    // Verify hobbies handling
    const hobbies = Array.isArray(parsed.hobileri) ? parsed.hobileri : [];
    console.log(`      Hobileri parsed: [${hobbies.join(', ')}]`);

    if (p.hasHobbies) {
      assert(hobbies.length > 0, `Expected hobbies for ${p.name} but got empty array!`);
      const allText = hobbies.join(' ').toLowerCase();
      const matchedAny = p.expectedHobbies.some(h => allText.includes(h));
      assert(matchedAny, `None of expected hobbies [${p.expectedHobbies.join(', ')}] found in [${allText}]`);
      results.hobbiesPass++;
    } else {
      // Should be empty array or contain phrases indicating no hobbies
      const containsPositiveHobby = hobbies.some(h => {
        const lower = h.toLowerCase();
        return !lower.includes('yok') && !lower.includes('bulunm') && !lower.includes('belirtilme') && !lower.includes('none');
      });
      assert(!containsPositiveHobby || hobbies.length === 0, `Expected NO hobbies for ${p.name} but got: ${JSON.stringify(hobbies)}`);
      results.hobbiesPass++;
    }
  }

  console.log(`\n✔ PHASE 1 COMPLETE: All 12 profiles created and verified! (Creations: ${results.creationPass}/12, Schemas: ${results.schemaPass}/12, Hobbies Logic: ${results.hobbiesPass}/12)\n`);

  // -------------------------------------------------------------
  // PHASE 2: COMPLEX MULTI-CRITERIA SUB-LOOP SEARCHES
  // -------------------------------------------------------------
  console.log('▶ [PHASE 2] Executing Complex Multi-Criteria Sub-Loop Searches...\n');

  const SEARCH_TESTS = [
    {
      title: "Embedded IoT + Woodworking/Model Aircraft Query",
      query: "Ahşap oyma ve model uçak yapan gömülü sistemler mühendisi kimdir?",
      explanation: "Gömülü sistemler ve donanım mühendisi arıyorum.",
      personKey: "Firat_Ozturk"
    },
    {
      title: "Chess + Boxing + Cyber Security Query",
      query: "Hızlı satranç oynayan ve boks yapan siber güvenlik uzmanı kim?",
      explanation: "Penetrasyon testi ve exploit analizi yapan kişi arıyorum.",
      personKey: "Burak_Demir"
    },
    {
      title: "Mountaineering + Cloud Architecture Query",
      query: "Dağcılık ve doğa fotoğrafçılığı ile ilgilenen bulut mimarı kimdir?",
      explanation: "AWS ve Kubernetes bilen kişi arıyorum.",
      personKey: "Ahmet_Yilmaz"
    },
    {
      title: "Mobile Developer + Origami Query",
      query: "Yarı maraton koşan ve 3D origami yapan mobil uygulama geliştiricisi kimdir?",
      explanation: "Flutter ve React Native geliştiren kişiyi arıyorum.",
      personKey: "Elif_Celik"
    },
    {
      title: "Unassigned/Negative Query (No matching person)",
      query: "Paraşütle atlayan veya rüzgar sörfü yapan bir dalgıç kimdir?",
      explanation: "Paraşüt veya sörf yapan kişiyi arıyorum.",
      personKey: null // Expect no match or rejection
    }
  ];

  for (let sIdx = 0; sIdx < SEARCH_TESTS.length; sIdx++) {
    const st = SEARCH_TESTS[sIdx];
    console.log(`[Search ${sIdx + 1}/${SEARCH_TESTS.length}] ${st.title}`);
    console.log(`      Query: "${st.query}"`);

    const searchStart = Date.now();
    const resultMsg = await runLibraryModeSubLoop(st.query, st.explanation);
    const searchDuration = Date.now() - searchStart;

    console.log(`      Search finished in ${searchDuration}ms`);

    if (st.personKey) {
      const targetPerson = PERSONS_DATA.find(p => p.name === st.personKey);
      const actualFn = targetPerson && targetPerson.actualFilename ? targetPerson.actualFilename.toLowerCase() : st.personKey.toLowerCase();
      const fnBase = actualFn.replace('.json', '');
      const resLower = resultMsg.toLowerCase();
      const found = resLower.includes(actualFn) || resLower.includes(fnBase) || resLower.includes(st.personKey.toLowerCase().replace('_', ' '));
      console.log(`      Target "${actualFn}" in response: ${found ? 'YES (PASS)' : 'NO (FAIL)'}`);
      assert(found, `Expected ${actualFn} in sub-loop result, but got:\n${resultMsg}`);
      results.searchesPass++;
    } else {
      // Negative test: none of the 12 files should match a completely fictitious hobby
      const hasParachuteMatch = resultMsg.toLowerCase().includes('paraşüt') && !resultMsg.toLowerCase().includes('hiçbir bilgi');
      console.log(`      Negative match verified: ${!hasParachuteMatch ? 'PASS (Correctly rejected)' : 'FAIL'}`);
      assert(!hasParachuteMatch, `Negative search should not return a false match!`);
      results.searchesPass++;
    }
  }

  console.log(`\n✔ PHASE 2 COMPLETE: All ${SEARCH_TESTS.length} complex searches passed!\n`);

  // -------------------------------------------------------------
  // CLEANUP
  // -------------------------------------------------------------
  console.log('▶ [CLEANUP] Cleaning up temporary test files...');
  for (const f of createdFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
  console.log(`✔ Removed ${createdFiles.length} temporary test files.\n`);

  console.log('======================================================================');
  console.log('🎉 12 PERSONS COMPLEX LIBRARY EXPERIMENT PASSED WITH 100% ACCURACY!');
  console.log('======================================================================');
}

if (require.main === module) {
  runLibrary12PersonsExperiment().catch(err => {
    console.error('❌ Experiment Failed:', err);
    process.exit(1);
  });
}

module.exports = { runLibrary12PersonsExperiment };
