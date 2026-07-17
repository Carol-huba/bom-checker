(function (global) {
  "use strict";

  const FALLBACK_TEMPLATE = {
    headers: [
      "搴忓彿",
      "Reference Designator *",
      "Quantity *",
      "MPN or Seeed SKU",
      "Manufacturer *",
      "Package / Footprint *",
      "Value / Specification",
      "Datasheet",
      "Alternative Parts",
    ],
    required: ["ref", "qty", "mpn", "manufacturer", "package"],
  };

  const CANONICAL_LABELS = {
    ref: "Reference Designator",
    qty: "Quantity",
    mpn: "MPN or Seeed SKU",
    manufacturer: "Manufacturer",
    package: "Package / Footprint",
    value: "Value / Specification",
    name: "Name",
    description: "Description",
    datasheet: "Datasheet / Link",
  };

  const SOFT_TEMPLATE_FIELDS = new Set(["manufacturer", "package"]);

  const state = {
    template: FALLBACK_TEMPLATE,
    lastResult: null,
    lastFileName: "",
  };

  const selectors = {
    fileInput: "#fileInput",
    pickButton: "#pickButton",
    dropZone: "#dropZone",
    currentFile: "#currentFile",
    currentFileName: "#currentFileName",
    sampleButton: "#sampleButton",
    exportReportButton: "#exportReportButton",
    templateStatus: "#templateStatus",
    rulesList: "#rulesList",
    fileTitle: "#fileTitle",
    fileSubtitle: "#fileSubtitle",
    errorCount: "#errorCount",
    warningCount: "#warningCount",
    rowCount: "#rowCount",
    refCount: "#refCount",
    issues: "#issues",
    previewTable: "#previewTable",
    headerStatus: "#headerStatus",
    severityFilter: "#severityFilter",
  };

  const $ = (selector) => document.querySelector(selector);

  function cleanText(value) {
    return value == null ? "" : String(value).replace(/\u00a0/g, " ").trim();
  }

  function normalizeForMatch(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/\*/g, "")
      .replace(/[\s/_\-.()]+/g, "");
  }

  function canonicalHeader(header) {
    const key = normalizeForMatch(header);
    if (!key) return null;
    if (
      key.includes("referencedesignator") ||
      key === "designator" ||
      key === "refdes" ||
      key === "ref" ||
      key.includes("浣嶅彿")
    ) {
      return "ref";
    }
    if (key === "qty" || key.includes("quantity") || key.includes("\u6570\u91cf")) return "qty";
    if (
      key === "mpn" ||
      key.includes("mpnorseeedsku") ||
      key.includes("manufacturerpartnumber") ||
      key.includes("partnumber") ||
      key.includes("seeedsku")
    ) {
      return "mpn";
    }
    if (key === "manufacturer" || key.includes("\u5236\u9020\u5546")) return "manufacturer";
    if (key.includes("package") || key.includes("footprint") || key.includes("\u5c01\u88c5")) return "package";
    if (key.includes("valuespecification") || key === "value" || key.includes("\u89c4\u683c")) return "value";
    if (key === "name" || key === "partname") return "name";
    if (key === "description" || key.includes("\u63cf\u8ff0")) return "description";
    if (key === "datasheet" || key === "link" || key === "partlink" || key.includes("url")) return "datasheet";
    return null;
  }

  function detectHeaderRow(rows) {
    let best = { index: -1, score: 0, map: {}, headers: [] };
    rows.slice(0, 20).forEach((row, index) => {
      const map = {};
      let score = 0;
      row.forEach((cell, columnIndex) => {
        const canonical = canonicalHeader(cell);
        if (canonical && map[canonical] == null) {
          map[canonical] = columnIndex;
          score += canonical === "ref" || canonical === "qty" || canonical === "mpn" ? 3 : 1;
        }
      });
      if (score > best.score) best = { index, score, map, headers: row.map(cleanText) };
    });
    return best.score >= 5 ? best : null;
  }

  function analyzeTemplate(rows) {
    const headerInfo = detectHeaderRow(rows);
    if (!headerInfo) return FALLBACK_TEMPLATE;
    const requiredMarkerRow = rows[headerInfo.index + 1] || [];
    const required = [];
    headerInfo.headers.forEach((header, index) => {
      const canonical = canonicalHeader(header);
      const markedRequired = /^required$/i.test(cleanText(requiredMarkerRow[index])) || /\*$/.test(cleanText(header));
      if (canonical && markedRequired && !required.includes(canonical)) required.push(canonical);
    });
    return {
      headers: headerInfo.headers,
      required: required.length ? required : FALLBACK_TEMPLATE.required,
    };
  }

  function rowsToRecords(rows, headerInfo) {
    const records = [];
    for (let i = headerInfo.index + 1; i < rows.length; i += 1) {
      const raw = rows[i].map(cleanText);
      if (!raw.some(Boolean)) continue;
      const repaired = repairSplitDesignatorRow(raw, headerInfo);
      const fields = {};
      Object.entries(headerInfo.map).forEach(([key, columnIndex]) => {
        fields[key] = cleanText(repaired.values[columnIndex]);
      });
      records.push({
        rowNumber: i + 1,
        raw,
        fields,
        repaired,
      });
    }
    return records;
  }

  function repairSplitDesignatorRow(raw, headerInfo) {
    const width = headerInfo.headers.length;
    const map = headerInfo.map;
    if (
      raw.length <= width ||
      map.ref == null ||
      map.ref !== 0 ||
      map.mpn == null ||
      map.qty == null ||
      map.mpn <= map.ref
    ) {
      return { values: raw, splitDesignator: false };
    }
    const extra = raw.length - width;
    const values = raw.slice();
    const refEnd = map.mpn + extra;
    values[map.ref] = raw.slice(map.ref, refEnd).join(",");
    Object.entries(map).forEach(([field, originalIndex]) => {
      if (field !== "ref" && originalIndex > map.ref) values[originalIndex] = raw[originalIndex + extra];
    });
    return { values, splitDesignator: true };
  }

  function parseDelimitedText(text) {
    const normalized = text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const firstLine = normalized.split("\n").find((line) => line.trim()) || "";
    const delimiters = [",", "\t", ";"];
    const delimiter = delimiters
      .map((candidate) => ({ candidate, count: countDelimiter(firstLine, candidate) }))
      .sort((a, b) => b.count - a.count)[0].candidate;
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < normalized.length; i += 1) {
      const char = normalized[i];
      const next = normalized[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" && !quoted) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.map((cells) => cells.map(cleanText)).filter((cells) => cells.some(Boolean));
  }

  function countDelimiter(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '"') quoted = !quoted;
      if (line[i] === delimiter && !quoted) count += 1;
    }
    return count;
  }

  async function parseXlsxArrayBuffer(buffer) {
    const entries = readZipEntries(buffer);
    const getText = async (name) => {
      const entry = entries.get(name);
      if (!entry) return "";
      const bytes = await inflateZipEntry(entry);
      return new TextDecoder("utf-8").decode(bytes);
    };
    const sharedStrings = await readSharedStrings(getText);
    const sheetPath = await getFirstWorksheetPath(getText);
    const sheetXml = await getText(sheetPath || "xl/worksheets/sheet1.xml");
    if (!sheetXml) throw new Error("Worksheet data was not found.");
    return parseWorksheetXml(sheetXml, sharedStrings);
  }

  function readZipEntries(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("XLSX ZIP 鐩綍鎹熷潖");
    const totalEntries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder("utf-8");
    for (let i = 0; i < totalEntries; i += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("XLSX ZIP 涓ぎ鐩綍鎹熷潖");
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      entries.set(name, {
        name,
        method,
        data: bytes.slice(dataOffset, dataOffset + compressedSize),
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateZipEntry(entry) {
    if (entry.method === 0) return entry.data;
    if (entry.method !== 8) throw new Error(`涓嶆敮鎸佺殑 XLSX 鍘嬬缉鏂瑰紡: ${entry.method}`);
    if (typeof DecompressionStream === "undefined") throw new Error("褰撳墠娴忚鍣ㄤ笉鏀寔鏈湴 XLSX 瑙ｅ帇");
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const response = new Response(stream);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function readSharedStrings(getText) {
    const xml = await getText("xl/sharedStrings.xml");
    if (!xml) return [];
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.getElementsByTagNameNS("*", "si")).map((si) =>
      Array.from(si.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent || "")
        .join("")
    );
  }

  async function getFirstWorksheetPath(getText) {
    const workbookXml = await getText("xl/workbook.xml");
    const relsXml = await getText("xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relsXml) return "xl/worksheets/sheet1.xml";
    const relDoc = new DOMParser().parseFromString(relsXml, "application/xml");
    const rels = {};
    Array.from(relDoc.getElementsByTagNameNS("*", "Relationship")).forEach((rel) => {
      rels[rel.getAttribute("Id")] = rel.getAttribute("Target");
    });
    const workbookDoc = new DOMParser().parseFromString(workbookXml, "application/xml");
    const sheet = workbookDoc.getElementsByTagNameNS("*", "sheet")[0];
    const relationshipId = sheet && (sheet.getAttribute("r:id") || sheet.getAttribute("id"));
    const target = rels[relationshipId] || "worksheets/sheet1.xml";
    return target.startsWith("xl/") ? target : `xl/${target.replace(/^\/xl\//, "")}`;
  }

  function parseWorksheetXml(xml, sharedStrings) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const rows = [];
    Array.from(doc.getElementsByTagNameNS("*", "row")).forEach((rowNode) => {
      const row = [];
      Array.from(rowNode.getElementsByTagNameNS("*", "c")).forEach((cell) => {
        const ref = cell.getAttribute("r") || "";
        const columnIndex = columnNameToIndex(ref.replace(/[0-9]/g, ""));
        while (row.length < columnIndex) row.push("");
        row[columnIndex] = readCellValue(cell, sharedStrings);
      });
      rows.push(row.map(cleanText));
    });
    return rows.filter((row) => row.some(Boolean));
  }

  function readCellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t");
    if (type === "inlineStr") {
      return Array.from(cell.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent || "")
        .join("");
    }
    const valueNode = cell.getElementsByTagNameNS("*", "v")[0];
    const value = valueNode ? valueNode.textContent || "" : "";
    if (type === "s") return sharedStrings[Number(value)] || "";
    return value;
  }

  function columnNameToIndex(name) {
    let index = 0;
    for (const char of name.toUpperCase()) {
      if (char < "A" || char > "Z") continue;
      index = index * 26 + char.charCodeAt(0) - 64;
    }
    return Math.max(0, index - 1);
  }

  async function parseFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx") return parseXlsxArrayBuffer(await file.arrayBuffer());
    return parseDelimitedText(decodeTextBuffer(await file.arrayBuffer()));
  }

  function decodeTextBuffer(buffer) {
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    if (!utf8.includes("\ufffd")) return utf8;
    try {
      const gb18030 = new TextDecoder("gb18030").decode(buffer);
      return replacementCount(gb18030) < replacementCount(utf8) ? gb18030 : utf8;
    } catch {
      return utf8;
    }
  }

  function replacementCount(text) {
    return (text.match(/\ufffd/g) || []).length;
  }

  function validateBom(rows, template) {
    const headerInfo = detectHeaderRow(rows);
    const issues = [];
    if (!headerInfo) {
      return {
        fileOk: false,
        headerInfo: null,
        records: [],
        issues: [
          issue("error", "表头识别失败", "未找到 Designator / Quantity / MPN 等关键列。", null, "Header"),
        ],
        summary: { errors: 1, warnings: 0, infos: 0, rows: 0, refs: 0 },
      };
    }

    const records = rowsToRecords(rows, headerInfo);
    template.required.forEach((field) => {
      if (headerInfo.map[field] == null) {
        const severity = SOFT_TEMPLATE_FIELDS.has(field) ? "warning" : "error";
        issues.push(
          issue(
            severity,
            SOFT_TEMPLATE_FIELDS.has(field) ? "Recommended column is missing" : "Required column is missing",
            SOFT_TEMPLATE_FIELDS.has(field)
              ? `${CANONICAL_LABELS[field]} was not found. This is a warning only and does not block the BOM check.`
              : `${CANONICAL_LABELS[field]} is required by the template but was not found in the BOM.`,
            headerInfo.index + 1,
            CANONICAL_LABELS[field]
          )
        );
      }
    });

    records.forEach((record) => {
      template.required.forEach((field) => {
        if (headerInfo.map[field] != null && !record.fields[field]) {
          const severity = SOFT_TEMPLATE_FIELDS.has(field) ? "warning" : "error";
          issues.push(
            issue(
              severity,
              SOFT_TEMPLATE_FIELDS.has(field) ? "Recommended value is empty" : "Required value is empty",
              SOFT_TEMPLATE_FIELDS.has(field)
                ? `${CANONICAL_LABELS[field]} is recommended but empty in this row.`
                : `${CANONICAL_LABELS[field]} is required but empty in this row.`,
              record.rowNumber,
              CANONICAL_LABELS[field]
            )
          );
        }
      });
      if (record.repaired && record.repaired.splitDesignator) {
        issues.push(
          issue(
            "warning",
            "CSV designator list is not quoted",
            "The row has more columns than the header. The checker tried to merge the extra leading columns back into Reference Designator.",
            record.rowNumber,
            "Reference Designator"
          )
        );
      }
    });

    const refOccurrences = new Map();
    let totalRefs = 0;
    records.forEach((record) => {
      const refs = parseDesignators(record.fields.ref);
      record.refs = refs;
      totalRefs += refs.length;
      refs.forEach((ref) => {
        const list = refOccurrences.get(ref) || [];
        list.push(record.rowNumber);
        refOccurrences.set(ref, list);
      });

      validateRecordContent(record, issues);
    });

    refOccurrences.forEach((rowsForRef, ref) => {
      const uniqueRows = Array.from(new Set(rowsForRef));
      if (uniqueRows.length > 1) {
        issues.push(
          issue(
            "error",
            "Duplicate reference designator",
            `${ref} appears in multiple rows: ${uniqueRows.join(", ")}.`,
            uniqueRows[0],
            "Reference Designator"
          )
        );
      }
    });

    const summary = summarize(issues, records.length, totalRefs);
    return { fileOk: summary.errors === 0, headerInfo, records, issues, summary };
  }

  function validateRecordContent(record, issues) {
    const refs = record.refs || [];
    const qty = parseQuantity(record.fields.qty);
    if (record.fields.ref && refs.length === 0) {
      issues.push(issue("error", "Invalid reference designator format", "The checker could not parse valid reference designators from this cell.", record.rowNumber, "Reference Designator"));
    }
    if (qty == null && record.fields.qty) {
      issues.push(issue("error", "Invalid quantity format", `Quantity is not a valid integer: ${record.fields.qty}`, record.rowNumber, "Quantity"));
    }
    if (qty != null && refs.length && qty !== refs.length) {
      issues.push(
        issue(
          "error",
          "Quantity does not match reference designator count",
          `Parsed ${refs.length} reference designators, but Quantity is ${qty}.`,
          record.rowNumber,
          "Quantity"
        )
      );
    }

    const families = Array.from(new Set(refs.map(familyFromDesignator).filter(Boolean)));
    const descriptionText = record.fields.description || record.fields.value || "";
    const descriptionFieldLabel = record.fields.description ? "Description" : "Value / Specification";
    const searchableText = [record.fields.mpn, record.fields.value, record.fields.description, record.fields.manufacturer].filter(Boolean).join(" ");
    if (families.length > 1 && !isNoMountRow(searchableText)) {
      issues.push(
        issue(
          "error",
          "Mixed component types in one BOM line",
          `This row contains ${families.map(labelFamily).join(" and ")} reference designator families: ${refs.join(", ")}.`,
          record.rowNumber,
          "Reference Designator"
        )
      );
    }

    const dominantFamily = families.length === 1 ? families[0] : null;
    const mpnType = inferPartType(record.fields.mpn);
    const descriptionType = inferPartType(descriptionText);
    if (dominantFamily && mpnType && !isCompatibleFamily(dominantFamily, mpnType)) {
      issues.push(
        issue(
          "error",
          "MPN does not match reference designator type",
          `${record.fields.mpn || "(empty)"} appears to be ${labelFamily(mpnType)}, but the reference designator family is ${labelFamily(dominantFamily)}.`,
          record.rowNumber,
          "MPN"
        )
      );
    }
    if (mpnType && descriptionType && !isCompatibleFamily(mpnType, descriptionType)) {
      issues.push(
        issue(
          "warning",
          "MPN and description type mismatch",
          `MPN appears to be ${labelFamily(mpnType)}, while the description appears to be ${labelFamily(descriptionType)}.`,
          record.rowNumber,
          descriptionFieldLabel
        )
      );
    }

    const mpnResistance = extractResistance(record.fields.mpn);
    const descriptionResistance = extractResistance(descriptionText);
    if (mpnResistance != null && descriptionResistance != null) {
      const diff = Math.abs(mpnResistance - descriptionResistance);
      const base = Math.max(Math.abs(mpnResistance), Math.abs(descriptionResistance), 1);
      if (diff / base > 0.05) {
        issues.push(
          issue(
            "error",
            "MPN and description resistance mismatch",
            `MPN resistance is ${formatOhms(mpnResistance)}, while description resistance is ${formatOhms(descriptionResistance)}.`,
            record.rowNumber,
            descriptionFieldLabel
          )
        );
      }
    }
  }

  function parseQuantity(value) {
    const text = cleanText(value);
    if (!text) return null;
    const number = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(number) || Math.round(number) !== number || number < 0) return null;
    return number;
  }

  function parseDesignators(value) {
    return cleanText(value)
      .replace(/[\uFF0C\u3001;\uFF1B]/g, ",")
      .replace(/\r?\n/g, ",")
      .split(",")
      .flatMap(expandDesignatorToken)
      .map((part) => part.replace(/\s+/g, "").toUpperCase())
      .filter((part) => /^[A-Z]+[-A-Z]*\d+[A-Z0-9-]*$/.test(part));
  }

  function expandDesignatorToken(token) {
    const text = cleanText(token).replace(/\s+/g, "").toUpperCase();
    const range = text.match(/^([A-Z]+)(\d+)[-~]([A-Z]+)?(\d+)$/);
    if (!range) return [text];
    const prefix = range[1];
    const endPrefix = range[3] || prefix;
    const start = Number(range[2]);
    const end = Number(range[4]);
    if (prefix !== endPrefix || end < start || end - start > 200) return [text];
    return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${start + index}`);
  }

  function familyFromDesignator(ref) {
    const prefix = (cleanText(ref).toUpperCase().match(/^[A-Z]+/) || [""])[0];
    if (!prefix) return null;
    if (prefix === "CR" || prefix === "LED" || prefix === "D") return "diode";
    if (prefix === "C") return "capacitor";
    if (prefix === "R" || prefix === "RN" || prefix === "RP" || prefix === "RT") return "resistor";
    if (prefix === "L" || prefix === "FB") return "inductor";
    if (prefix === "Q" || prefix === "T") return "transistor";
    if (prefix === "U" || prefix === "IC") return "ic";
    if (prefix === "J" || prefix === "P" || prefix === "CN" || prefix === "CON") return "connector";
    if (prefix === "F") return "fuse";
    if (prefix === "K" || prefix === "RL") return "relay";
    if (prefix === "SW" || prefix === "S") return "switch";
    if (prefix === "X" || prefix === "Y" || prefix === "XTAL") return "crystal";
    if (prefix === "TP" || prefix === "H" || prefix === "MH" || prefix === "M") return "mechanical";
    return null;
  }

  function inferPartType(value) {
    const text = cleanText(value).toUpperCase();
    if (!text) return null;
    if (/CAPACITOR|CAP|UF|NF|PF|µF|GRM|GCM|GRT|CC\d{4}|CL\d{2}|CGA|T491|EEE[-_]?|F95|SVPC|0402B\d{3}|0603B\d{3}|1206Y/.test(text)) return "capacitor";
    if (/RESISTOR|OHMS?|Ω|Ω|ERJ[-_]?|CRCW|RK73|RC\d{4}|RT\d{4}|0R\d/.test(text)) return "resistor";
    if (/DIODE|LED|TVS|ESD|B540|SS14|TSAL|LTST|APA\d/.test(text)) return "diode";
    if (/MOSFET|TRANSISTOR|N-CHANNEL|P-CHANNEL|2N7002|FDC\d|RK7002|BSS|MMBT/.test(text)) return "transistor";
    if (/CONNECTOR|HEADER|JST|MOLEX|SAMTEC|BM\d{2}B|SM\d{2}B|SMM-|PJ-|SIM\d|MM60/.test(text)) return "connector";
    if (/INDUCTOR|FERRITE|FBM|LBR|AISC/.test(text)) return "inductor";
    if (/FUSE|POLYFUSE|0ZC|MF-MSMF/.test(text)) return "fuse";
    if (/RELAY|G3VM|EE2-/.test(text)) return "relay";
    if (/SWITCH|MCDM/.test(text)) return "switch";
    if (/LTC\d|DRV\d|MCP\d|ESP32|W25Q|MIC\d|BTS\d|AMPLIFIER|MICROCONTROLLER|OP AMP/.test(text)) return "ic";
    return null;
  }

  function isCompatibleFamily(expected, actual) {
    if (expected === actual) return true;
    if (expected === "diode" && actual === "transistor") return false;
    return false;
  }

  function isNoMountRow(value) {
    return /DNP|DNF|NO\s*MOUNT|NOT\s*PLACED|DO\s*NOT\s*ASSEMB|DON'?T\s*ASSEMBLY|\u4E0D\u8D34|\u4E0D\u88C5|\u4E0D\u4E0A\u4EF6/i.test(value);
  }

  function extractResistance(value) {
    const text = cleanText(value).toUpperCase();
    if (!text) return null;
    let match = text.match(/(\d+(?:\.\d+)?)\s*(K|M|MEG)?\s*(?:OHMS?|Ω|Ω)/);
    if (match) return scaleResistance(Number(match[1]), match[2]);
    match = text.match(/(\d+)R(\d*)/);
    if (match) return Number(`${match[1]}.${match[2] || "0"}`);
    match = text.match(/(\d+)K(\d*)/);
    if (match && !/[A-Z]/.test(text[match.index - 1] || "")) return Number(`${match[1]}.${match[2] || "0"}`) * 1000;
    match = text.match(/(?:ERJ|RC|CRCW|RK|RT)[A-Z0-9-]*?([0-9]{3,4})[A-Z]?$/);
    if (match) return decodeEiaResistance(match[1]);
    return null;
  }

  function scaleResistance(value, unit) {
    if (unit === "K") return value * 1000;
    if (unit === "M" || unit === "MEG") return value * 1000000;
    return value;
  }

  function decodeEiaResistance(code) {
    if (code.length === 3) {
      return Number(code.slice(0, 2)) * 10 ** Number(code[2]);
    }
    if (code.length === 4) {
      return Number(code.slice(0, 3)) * 10 ** Number(code[3]);
    }
    return null;
  }

  function formatOhms(value) {
    if (value >= 1000000) return `${trimNumber(value / 1000000)} MOhm`;
    if (value >= 1000) return `${trimNumber(value / 1000)} kOhm`;
    return `${trimNumber(value)} Ohm`;
  }

  function trimNumber(value) {
    return Number(value.toFixed(3)).toString();
  }

  function labelFamily(family) {
    return (
      {
        capacitor: "capacitor",
        resistor: "resistor",
        diode: "diode/LED",
        transistor: "transistor/MOSFET",
        ic: "IC",
        connector: "connector",
        inductor: "inductor/ferrite bead",
        fuse: "fuse",
        relay: "relay",
        switch: "switch",
        crystal: "crystal",
        mechanical: "mechanical part",
      }[family] || family
    );
  }

  function issue(severity, title, detail, rowNumber, field) {
    return { severity, title, detail, rowNumber, field };
  }

  function summarize(issues, rows, refs) {
    return {
      errors: issues.filter((item) => item.severity === "error").length,
      warnings: issues.filter((item) => item.severity === "warning").length,
      infos: issues.filter((item) => item.severity === "info").length,
      rows,
      refs,
    };
  }

  async function loadTemplateFromServer() {
    try {
      const response = await fetch("Bom_template.xlsx", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await parseXlsxArrayBuffer(await response.arrayBuffer());
      state.template = analyzeTemplate(rows);
      renderTemplateStatus(true, "宸茶鍙?Bom_template.xlsx");
    } catch (error) {
      state.template = FALLBACK_TEMPLATE;
      renderTemplateStatus(false, "鏈兘璇诲彇妯℃澘锛屽凡浣跨敤鍐呯疆瑙勫垯");
      console.warn(error);
    }
    renderRules();
  }

  async function runFile(file) {
    setBusy(true);
    state.lastFileName = file.name;
    renderCurrentFile(file.name);
    try {
      const rows = await parseFile(file);
      const result = validateBom(rows, state.template);
      state.lastResult = result;
      renderResult(file.name, result);
    } catch (error) {
      renderFatal(file.name, error);
    } finally {
      setBusy(false);
    }
  }

  function renderCurrentFile(fileName) {
    const currentFile = $(selectors.currentFile);
    const name = $(selectors.currentFileName);
    if (!currentFile || !name) return;
    if (!fileName) {
      currentFile.hidden = true;
      name.textContent = "";
      return;
    }
    currentFile.hidden = false;
    name.textContent = fileName;
  }

  async function runSample() {
    try {
      const response = await fetch("Bom_template.xlsx", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const file = new File([await response.blob()], "Bom_template.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      await runFile(file);
    } catch (error) {
      renderFatal("Bom_template.xlsx", error);
    }
  }

  function renderTemplateStatus(ok, text) {
    const el = $(selectors.templateStatus);
    el.innerHTML = `<span class="status-dot ${ok ? "ready" : "failed"}"></span><span>${escapeHtml(text)}</span>`;
  }

  function renderRules() {
    const required = state.template.required
      .map((field) => {
        const label = SOFT_TEMPLATE_FIELDS.has(field) ? "Recommended" : "Required";
        return `<div class="rule-chip"><span>${escapeHtml(CANONICAL_LABELS[field])}</span><strong>${label}</strong></div>`;
      })
      .join("");
    $(selectors.rulesList).innerHTML = required;
  }

  function renderResult(fileName, result) {
    $(selectors.fileTitle).textContent = fileName;
    $(selectors.fileSubtitle).textContent = result.fileOk ? "No blocking errors found. Please continue manual review." : "Issues requiring correction were found.";
    $(selectors.errorCount).textContent = result.summary.errors;
    $(selectors.warningCount).textContent = result.summary.warnings;
    $(selectors.rowCount).textContent = result.summary.rows;
    $(selectors.refCount).textContent = result.summary.refs;
    $(selectors.headerStatus).textContent = result.headerInfo
      ? `Header row ${result.headerInfo.index + 1}; matched ${Object.keys(result.headerInfo.map).length} columns`
      : "Header not detected";
    const exportButton = $(selectors.exportReportButton);
    if (exportButton) exportButton.disabled = !result.issues.length;
    renderIssues();
    renderPreview(result);
  }

  function renderIssues() {
    const result = state.lastResult;
    const container = $(selectors.issues);
    if (!result) return;
    const filter = $(selectors.severityFilter).value;
    const issues = result.issues.filter((item) => filter === "all" || item.severity === filter);
    if (!issues.length) {
      container.innerHTML = `<div class="empty-state"><strong>No issues under the current filter</strong><span>Warnings and errors will appear here after a BOM is checked.</span></div>`;
      return;
    }
    container.innerHTML = issues
      .map(
        (item) => `
        <article class="issue ${item.severity}">
          <div class="issue-top">
            <span class="issue-title">${escapeHtml(item.title)}</span>
            <span class="badge ${item.severity}">${severityLabel(item.severity)}</span>
          </div>
          <div class="issue-meta">${item.rowNumber ? `Row ${item.rowNumber}` : "Header"} / ${escapeHtml(item.field || "")}</div>
          <div class="issue-detail">${escapeHtml(item.detail)}</div>
        </article>`
      )
      .join("");
  }

  function fieldToCanonicalKeys(field) {
    const normalized = normalizeForMatch(field);
    if (!normalized) return [];
    if (normalized.includes("reference") || normalized.includes("designator")) return ["ref"];
    if (normalized.includes("quantity") || normalized === "qty") return ["qty"];
    if (normalized.includes("mpn") || normalized.includes("partnumber")) return ["mpn"];
    if (normalized.includes("manufacturer")) return ["manufacturer"];
    if (normalized.includes("package") || normalized.includes("footprint")) return ["package"];
    if (normalized.includes("description")) return ["description", "value"];
    if (normalized.includes("value") || normalized.includes("specification")) return ["value", "description"];
    return [];
  }

  function strongestSeverity(left, right) {
    const order = { error: 3, warning: 2, info: 1 };
    return (order[right] || 0) > (order[left] || 0) ? right : left;
  }

  function buildPreviewMarks(result) {
    const marks = new Map();
    if (!result.headerInfo) return marks;
    result.issues.forEach((item) => {
      if (!item.rowNumber || item.rowNumber <= result.headerInfo.index + 1) return;
      const rowMarks = marks.get(item.rowNumber) || { rowSeverity: item.severity, cells: new Map(), wholeRow: false };
      rowMarks.rowSeverity = strongestSeverity(rowMarks.rowSeverity, item.severity);
      const columns = fieldToCanonicalKeys(item.field)
        .map((key) => result.headerInfo.map[key])
        .filter((index) => index != null);
      if (!columns.length) {
        rowMarks.wholeRow = true;
      } else {
        columns.forEach((columnIndex) => {
          rowMarks.cells.set(columnIndex, strongestSeverity(rowMarks.cells.get(columnIndex), item.severity));
        });
      }
      marks.set(item.rowNumber, rowMarks);
    });
    return marks;
  }

  function renderPreview(result) {
    const table = $(selectors.previewTable);
    if (!result.headerInfo || !result.records.length) {
      table.innerHTML = `<tbody><tr><td class="placeholder">鏆傛棤鍙瑙堟暟鎹?/td></tr></tbody>`;
      return;
    }
    const headers = result.headerInfo.headers;
    const marks = buildPreviewMarks(result);
    const body = result.records
      .slice(0, 80)
      .map((record) => {
        const rowMarks = marks.get(record.rowNumber);
        const rowClass = rowMarks && rowMarks.wholeRow ? ' class="row-error"' : "";
        return `<tr${rowClass}>${headers
          .map((_, index) => {
            const severity = rowMarks && rowMarks.cells.get(index);
            const cls = severity ? ` class="cell-${severity}"` : "";
            return `<td${cls}>${escapeHtml(record.raw[index] || "")}</td>`;
          })
          .join("")}</tr>`;
      })
      .join("");
    table.innerHTML = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
  }

  function renderFatal(fileName, error) {
    const result = {
      headerInfo: null,
      records: [],
      issues: [issue("error", "鏂囦欢瑙ｆ瀽澶辫触", error.message || String(error), null, fileName)],
      summary: { errors: 1, warnings: 0, infos: 0, rows: 0, refs: 0 },
    };
    state.lastResult = result;
    renderResult(fileName, result);
  }

  function exportIssueReport() {
    const result = state.lastResult;
    if (!result) return;
    const fileName = state.lastFileName || $(selectors.fileTitle).textContent || "bom";
    const report = buildEnglishReport(fileName, result);
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileStem(fileName)}_bom_issue_report.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function buildEnglishReport(fileName, result) {
    const lines = [];
    lines.push("# BOM Issue Report");
    lines.push("");
    lines.push(`File: ${fileName}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Errors: ${result.summary.errors}`);
    lines.push(`- Warnings: ${result.summary.warnings}`);
    lines.push(`- BOM rows: ${result.summary.rows}`);
    lines.push(`- Reference designators: ${result.summary.refs}`);
    lines.push("");
    lines.push("## Issues");
    lines.push("");
    if (!result.issues.length) {
      lines.push("No issues were detected.");
      return lines.join("\n");
    }
    lines.push("| # | Severity | Row | Field | Issue | Details |");
    lines.push("|---:|---|---:|---|---|---|");
    result.issues.forEach((item, index) => {
      const english = issueToEnglish(item);
      lines.push(
        `| ${index + 1} | ${capitalize(item.severity)} | ${item.rowNumber || "All"} | ${escapeMarkdownTable(item.field || "")} | ${escapeMarkdownTable(english.title)} | ${escapeMarkdownTable(english.detail)} |`
      );
    });
    return lines.join("\n");
  }

  function issueToEnglish(item) {
    return {
      title: item.title || "BOM issue",
      detail: item.detail || "Please review this row and field in the source BOM.",
    };
  }

  function safeFileStem(fileName) {
    return cleanText(fileName).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "bom";
  }

  function escapeMarkdownTable(value) {
    return cleanText(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  }

  function capitalize(value) {
    const text = cleanText(value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function severityLabel(severity) {
    return { error: "Error", warning: "Warning", info: "Info" }[severity] || severity;
  }

  function setBusy(isBusy) {
    $(selectors.pickButton).textContent = isBusy ? "Checking..." : "Select file";
    $(selectors.pickButton).disabled = isBusy;
  }

  function escapeHtml(value) {
    return cleanText(value).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function bindUi() {
    const input = $(selectors.fileInput);
    const dropZone = $(selectors.dropZone);
    $(selectors.pickButton).addEventListener("click", (event) => {
      event.stopPropagation();
      input.click();
    });
    dropZone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) runFile(file);
    });
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) runFile(file);
    });
    $(selectors.sampleButton).addEventListener("click", runSample);
    $(selectors.exportReportButton).addEventListener("click", exportIssueReport);
    $(selectors.severityFilter).addEventListener("change", renderIssues);
    initResizeHandles();
  }

  function initResizeHandles() {
    setupResize({
      handle: document.querySelector("#outerResize"),
      onMove: (clientX) => {
        const workspace = document.querySelector(".workspace");
        const rect = workspace.getBoundingClientRect();
        const width = Math.min(Math.max(clientX - rect.left - 4, 280), 520);
        workspace.style.setProperty("--sidebar-width", `${width}px`);
      },
    });
    setupResize({
      handle: document.querySelector("#innerResize"),
      onMove: (clientX) => {
        const layout = document.querySelector(".result-layout");
        const rect = layout.getBoundingClientRect();
        const width = Math.min(Math.max(clientX - rect.left - 4, 320), rect.width - 380);
        layout.style.setProperty("--issues-width", `${width}px`);
      },
    });
  }

  function setupResize({ handle, onMove }) {
    if (!handle) return;
    let active = false;
    handle.addEventListener("pointerdown", (event) => {
      active = true;
      handle.classList.add("dragging");
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (active) onMove(event.clientX);
    });
    const stop = (event) => {
      if (!active) return;
      active = false;
      handle.classList.remove("dragging");
      if (event.pointerId != null) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function init() {
    bindUi();
    renderRules();
    loadTemplateFromServer();
  }

  const api = {
    analyzeTemplate,
    canonicalHeader,
    detectHeaderRow,
    parseDelimitedText,
    parseDesignators,
    decodeTextBuffer,
    validateBom,
  };

  global.BomChecker = api;
  if (typeof module !== "undefined") module.exports = api;
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", init);
})(typeof window !== "undefined" ? window : globalThis);
