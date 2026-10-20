/* AeroVane ArduPilot Dataflash Parser
   Fast, robust in-browser parser for ArduPilot Dataflash (.bin and .log) files. */

function buf2str(dv, offset, length) {
    let res = "";
    for (let idx = 0; idx < length; idx++) {
        if (offset + idx >= dv.byteLength) break;
        const b = dv.getUint8(offset + idx);
        if (b === 0) break;
        res += String.fromCharCode(b);
    }
    return res.trim();
}

const typelen = {
    'b': 1,  // int8_t
    'B': 1,  // uint8_t
    'h': 2,  // int16_t
    'H': 2,  // uint16_t
    'i': 4,  // int32_t
    'I': 4,  // uint32_t
    'f': 4,  // float
    'd': 8,  // double
    'n': 4,  // char[4]
    'N': 16, // char[16]
    'Z': 64, // char[64]
    'c': 2,  // int16_t * 100
    'C': 2,  // uint16_t * 100
    'e': 4,  // int32_t * 100
    'E': 4,  // uint32_t * 100
    'L': 4,  // int32_t latitude/longitude (* 1e7)
    'M': 1,  // uint8_t flight mode
    'q': 8,  // int64_t
    'Q': 8,  // uint64_t
    'a': 64, // int16_t[32]
    'A': 64  // uint16_t[32]
};

const readfunc = {
    'b': (dv, off) => dv.getInt8(off),
    'B': (dv, off) => dv.getUint8(off),
    'h': (dv, off) => dv.getInt16(off, true),
    'H': (dv, off) => dv.getUint16(off, true),
    'i': (dv, off) => dv.getInt32(off, true),
    'I': (dv, off) => dv.getUint32(off, true),
    'f': (dv, off) => dv.getFloat32(off, true),
    'd': (dv, off) => dv.getFloat64(off, true),
    'L': (dv, off) => dv.getInt32(off, true) / 10000000.0,
    'c': (dv, off) => dv.getInt16(off, true) / 100.0,
    'C': (dv, off) => dv.getUint16(off, true) / 100.0,
    'e': (dv, off) => dv.getInt32(off, true) / 100.0,
    'E': (dv, off) => dv.getUint32(off, true) / 100.0,
    'M': (dv, off) => dv.getUint8(off),
    'q': (dv, off) => Number(dv.getBigInt64(off, true)),
    'Q': (dv, off) => Number(dv.getBigUint64(off, true)),
    'n': (dv, off) => buf2str(dv, off, 4),
    'N': (dv, off) => buf2str(dv, off, 16),
    'Z': (dv, off) => buf2str(dv, off, 64),
    'a': (dv, off) => dv.getInt16(off, true),
    'A': (dv, off) => dv.getUint16(off, true)
};

function gps_coord_distance(a, b) {
    const latScale = 111320;
    const meanLat = (a.lat + b.lat) * Math.PI / 360;
    const dx = (a.lon - b.lon) * latScale * Math.cos(meanLat);
    const dy = (a.lat - b.lat) * latScale;
    return Math.hypot(dx, dy);
}

const msgt_with_instances = {
    "BARO": "I",
    "BAT": "Instance",
    "GPA": "I",
    "GPS": "I",
    "IMU": "I",
    "MAG": "I",
    "ESC": "Instance",
    "XKF0": "C",
    "XKF1": "C",
    "XKF2": "C",
    "XKF3": "C",
    "XKF4": "C",
    "XKF5": "C",
    "VIBE": "IMU",
    "ARSP": "I",
    "CTUN": "I",
    "POWR": "I"
};

class msgformat {
    constructor(dv, offset) {
        this.type = dv.getUint8(offset++);
        this.length = dv.getUint8(offset++);
        this.name = buf2str(dv, offset, 4);
        offset += 4;
        this.fields = buf2str(dv, offset, 16);
        offset += 16;
        this.columns = buf2str(dv, offset, 64);

        this.subitemlist = this.columns.split(",").map(s => s.trim()).filter(s => s.length > 0);
        this.subitemidx_from_name = {};
        for (let i = 0; i < this.subitemlist.length; i++) {
            this.subitemidx_from_name[this.subitemlist[i]] = i;
        }

        this.subitemoffset = [0];
        let offs = 0;
        for (let i = 0; i < this.subitemlist.length - 1; i++) {
            const ftype = this.fields[i];
            const flen = typelen[ftype] || 4;
            offs += flen;
            this.subitemoffset[i + 1] = offs;
        }

        const iname = msgt_with_instances[this.name] || (this.subitemidx_from_name["Instance"] !== undefined ? "Instance" : (this.subitemidx_from_name["I"] !== undefined && this.subitemlist.length > 3 ? "I" : null));
        this.with_instances = false;
        if (iname != null && this.subitemidx_from_name[iname] !== undefined) {
            const subitemidx = this.subitemidx_from_name[iname];
            this.instance_offset = this.subitemoffset[subitemidx];
            if (this.instance_offset != null) {
                this.with_instances = true;
            }
        }
        this.data = [];
    }
}

class logfile {
    constructor(buffer, progressCallback = null) {
        this.buffer = buffer;
        this.msgtypes = {};
        this.msgtype_name_hash = {};
        this.totalMessages = 0;
        this.parse(progressCallback);
        this.boot_time_ms_since_epoch = this.find_timebase();
    }

    parse(progressCallback = null) {
        const dv = new DataView(this.buffer);
        const len = dv.byteLength;
        let nextProgress = 0;

        for (let idx = 0; idx < len - 3;) {
            if (progressCallback && idx >= nextProgress) {
                progressCallback(Math.min(1, idx / Math.max(1, len)));
                nextProgress = idx + Math.max(1_048_576, Math.floor(len / 100));
            }
            // Check magic header: 0xA3 0x95
            if (dv.getUint8(idx) === 163 && dv.getUint8(idx + 1) === 149) {
                const msgtypeval = dv.getUint8(idx + 2);
                if (msgtypeval === 128) {
                    // FMT message (89 bytes)
                    if (idx + 89 <= len) {
                        try {
                            const msgt = new msgformat(dv, idx + 3);
                            if (msgt.name) {
                                this.msgtypes[msgt.type] = msgt;
                                this.msgtype_name_hash[msgt.name] = msgt.type;
                            }
                        } catch (e) {
                            console.warn("Error parsing FMT at offset", idx, e);
                        }
                        idx += 89;
                        continue;
                    }
                } else if (this.msgtypes[msgtypeval] != null) {
                    const msgt = this.msgtypes[msgtypeval];
                    const msgLen = msgt.length || 3;
                    if (idx + msgLen <= len) {
                        this.totalMessages++;
                        const payloadOffset = idx + 3;
                        if (msgt.with_instances && msgt.instance_offset != null && payloadOffset + msgt.instance_offset < len) {
                            const instance = dv.getUint8(payloadOffset + msgt.instance_offset);
                            if (!msgt.data[instance]) {
                                msgt.data[instance] = [];
                            }
                            msgt.data[instance].push(payloadOffset);
                        } else {
                            msgt.data.push(payloadOffset);
                        }
                        idx += msgLen;
                        continue;
                    }
                }
            }
            idx++;
        }
        if (progressCallback) progressCallback(1);
    }

    to_snapshot() {
        const msgtypes = {};
        for (const [type, message] of Object.entries(this.msgtypes)) {
            msgtypes[type] = {
                type: message.type, length: message.length, name: message.name, fields: message.fields,
                columns: message.columns, subitemlist: message.subitemlist,
                subitemidx_from_name: message.subitemidx_from_name, subitemoffset: message.subitemoffset,
                with_instances: message.with_instances, instance_offset: message.instance_offset, data: message.data
            };
        }
        return { msgtypes, msgtype_name_hash: this.msgtype_name_hash, totalMessages: this.totalMessages,
            boot_time_ms_since_epoch: this.boot_time_ms_since_epoch };
    }

    static from_snapshot(buffer, snapshot) {
        const value = Object.create(logfile.prototype);
        value.buffer = buffer;
        value.msgtypes = snapshot.msgtypes;
        value.msgtype_name_hash = snapshot.msgtype_name_hash;
        value.totalMessages = snapshot.totalMessages;
        value.boot_time_ms_since_epoch = snapshot.boot_time_ms_since_epoch;
        return value;
    }

    get_msgitem_list() {
        const list = Object.values(this.msgtypes).filter(m => m && m.name);
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Decode every DataFlash packet into a timestamp-ordered neutral record. */
    get_records(progressCallback = null, allowedNames = null, sampleIntervalsMs = null) {
        if (Object.keys(this.msgtypes).length === 0 || this.totalMessages === 0) {
            throw new Error("No supported DataFlash messages were found. The file may be corrupt or unsupported.");
        }

        const dv = new DataView(this.buffer);
        const records = [];
        let decoded = 0;
        let nextProgress = 0;
        const lastSampleAt = new Map();
        const totalToDecode = Object.values(this.msgtypes).reduce((total, msgt) => {
            if (!msgt || !msgt.name || (allowedNames && !allowedNames.has(msgt.name))) return total;
            if (!msgt.with_instances) return total + (msgt.data?.length || 0);
            return total + Array.from(msgt.data.entries()).reduce((sum, [, offsets]) => sum + (Array.isArray(offsets) ? offsets.length : 0), 0);
        }, 0);
        for (const msgt of Object.values(this.msgtypes)) {
            if (!msgt || !msgt.name) continue;
            if (allowedNames && !allowedNames.has(msgt.name)) continue;

            const sampleInterval = sampleIntervalsMs?.[msgt.name];
            const subidxMap = msgt.subitemidx_from_name || (msgt.subitemlist ? Object.fromEntries(msgt.subitemlist.map((s, idx) => [s, idx])) : {});
            const timeIndex = subidxMap.TimeUS ?? subidxMap.TimeMS;
            const timeField = timeIndex == null ? null : msgt.subitemlist?.[timeIndex];
            const timeReader = timeIndex == null ? null : readfunc[msgt.fields?.[timeIndex]];
            const timeSubOffset = timeIndex == null ? null : msgt.subitemoffset?.[timeIndex];
            const isTimeUS = timeField === 'TimeUS';

            // Pre-compile field descriptors for this message format
            const fieldDescs = [];
            const subitems = msgt.subitemlist || [];
            for (let fi = 0; fi < subitems.length; fi++) {
                const reader = readfunc[msgt.fields?.[fi]];
                if (reader) {
                    fieldDescs.push({
                        name: subitems[fi],
                        offset: msgt.subitemoffset?.[fi] ?? 0,
                        reader,
                        isTimeUS: subitems[fi] === 'TimeUS',
                        isTimeMS: subitems[fi] === 'TimeMS',
                    });
                }
            }

            const lists = msgt.with_instances
                ? Array.from(msgt.data.entries())
                    .filter(([, offsets]) => Array.isArray(offsets) && offsets.length > 0)
                    .map(([instance, offsets]) => ({ offsets, instance }))
                : [{ offsets: msgt.data || [], instance: null }];

            for (const group of lists) {
                const sampleKey = `${msgt.name}:${group.instance ?? 0}`;
                for (const offset of group.offsets) {
                    if (progressCallback && decoded >= nextProgress) {
                        progressCallback(Math.min(1, decoded / Math.max(1, totalToDecode)));
                        nextProgress = decoded + Math.max(1_000, Math.floor(totalToDecode / 100));
                    }
                    decoded++;

                    if (sampleInterval && timeReader && timeSubOffset != null) {
                        const timeOffset = offset + timeSubOffset;
                        if (timeOffset + 4 <= dv.byteLength) {
                            try {
                                const rawTime = Number(timeReader(dv, timeOffset));
                                const timestampMs = isTimeUS ? rawTime / 1000 : rawTime;
                                if (Number.isFinite(timestampMs)) {
                                    const previousTimestamp = lastSampleAt.get(sampleKey);
                                    if (previousTimestamp != null && timestampMs >= previousTimestamp && timestampMs - previousTimestamp < sampleInterval) {
                                        continue;
                                    }
                                    lastSampleAt.set(sampleKey, timestampMs);
                                }
                            } catch (_) {
                                // Fall through to full decoding if the fast timestamp read fails.
                            }
                        }
                    }

                    const values = {};
                    let timestampMs = null;
                    for (let fi = 0; fi < fieldDescs.length; fi++) {
                        const f = fieldDescs[fi];
                        const fieldOffset = offset + f.offset;
                        if (fieldOffset >= dv.byteLength) continue;
                        try {
                            const value = f.reader(dv, fieldOffset);
                            values[f.name] = value;
                            if (f.isTimeUS) timestampMs = Number(value) / 1000;
                            else if (f.isTimeMS && timestampMs == null) timestampMs = Number(value);
                        } catch (_) {
                            // A truncated field should not prevent analysis of the remaining log.
                        }
                    }
                    if (Number.isFinite(timestampMs)) {
                        records.push({ name: msgt.name, instance: group.instance, timestampMs, values });
                    }
                }
            }
        }
        records.sort((a, b) => a.timestampMs - b.timestampMs);
        if (progressCallback) progressCallback(1);
        return records;
    }

    find_timebase() {
        // Try GPS message first
        const gpstypeval = this.msgtype_name_hash["GPS"];
        if (gpstypeval != null && this.msgtypes[gpstypeval]) {
            const msgt = this.msgtypes[gpstypeval];
            const gmssubidx = msgt.subitemidx_from_name["GMS"];
            const gwksubidx = msgt.subitemidx_from_name["GWk"];
            const timesubidx = msgt.subitemidx_from_name["TimeUS"] !== undefined ? msgt.subitemidx_from_name["TimeUS"] : msgt.subitemidx_from_name["TimeMS"];
            const statusidx = msgt.subitemidx_from_name["Status"];

            if (gmssubidx != null && gwksubidx != null && timesubidx != null) {
                const gmsoffset = msgt.subitemoffset[gmssubidx];
                const gwkoffset = msgt.subitemoffset[gwksubidx];
                const timeoffset = msgt.subitemoffset[timesubidx];
                const statusoffset = statusidx != null ? msgt.subitemoffset[statusidx] : null;

                const gmsrf = readfunc[msgt.fields[gmssubidx]];
                const gwkrf = readfunc[msgt.fields[gwksubidx]];
                const timerf = readfunc[msgt.fields[timesubidx]];
                const statusrf = statusidx != null ? readfunc[msgt.fields[statusidx]] : null;

                const dv = new DataView(this.buffer);
                let dataindexlist = [];
                if (msgt.with_instances) {
                    dataindexlist = (msgt.data[0] || (msgt.data.length > 0 ? msgt.data.find(d => d && d.length) : null)) || [];
                } else {
                    dataindexlist = msgt.data || [];
                }

                for (let i = 0; i < dataindexlist.length; i++) {
                    const msgoffset = dataindexlist[i];
                    if (statusrf && statusoffset != null) {
                        const status = statusrf(dv, msgoffset + statusoffset);
                        if (status < 3) continue; // GPS 3D Fix required
                    }
                    if (gwkrf && gmsrf && timerf) {
                        const gwk = gwkrf(dv, msgoffset + gwkoffset);
                        const gms = gmsrf(dv, msgoffset + gmsoffset);
                        const rawTime = timerf(dv, msgoffset + timeoffset);
                        const time_since_boot_ms = typeof rawTime === 'bigint' ? Number(rawTime / 1000n) : Number(rawTime) / 1000;
                        if (gwk > 1000) { // Valid GPS week
                            const date_gps_start = Date.UTC(1980, 0, 6);
                            const time_gwk_ms = gwk * 7 * 24 * 3600 * 1000;
                            const msgtime_ms = date_gps_start + time_gwk_ms + gms;
                            return msgtime_ms - time_since_boot_ms;
                        }
                    }
                }
            }
        }
        return 0; // Relative time from 0
    }

    get_data_series(item, instance, subitem) {
        const msgtypeval = this.msgtype_name_hash[item];
        if (msgtypeval == null) return null;
        const msgt = this.msgtypes[msgtypeval];
        if (!msgt) return null;

        const subitemidx = msgt.subitemidx_from_name[subitem];
        if (subitemidx == null) return null;

        const labelName = item + (msgt.with_instances && instance >= 0 ? instance : "") + "." + subitem;
        const ds = {
            name: labelName,
            x: [],
            y: [],
            type: 'scatter',
            mode: 'lines',
            line: { width: 1.8 }
        };

        const timesubidx = msgt.subitemidx_from_name["TimeUS"] !== undefined 
            ? msgt.subitemidx_from_name["TimeUS"] 
            : (msgt.subitemidx_from_name["TimeMS"] !== undefined ? msgt.subitemidx_from_name["TimeMS"] : null);

        const subitemoffset = msgt.subitemoffset[subitemidx];
        const rf = readfunc[msgt.fields[subitemidx]] || readfunc['f'];
        const timerf = timesubidx != null ? (readfunc[msgt.fields[timesubidx]] || readfunc['Q']) : null;
        const timesuboff = timesubidx != null ? msgt.subitemoffset[timesubidx] : null;

        const dv = new DataView(this.buffer);
        let dataindexlist = [];
        if (msgt.with_instances) {
            dataindexlist = (instance >= 0 && msgt.data[instance]) ? msgt.data[instance] : (msgt.data[0] || []);
        } else {
            dataindexlist = msgt.data || [];
        }

        const isTimeUS = timesubidx != null && msgt.subitemlist[timesubidx] === "TimeUS";

        for (let i = 0; i < dataindexlist.length; i++) {
            const msgoffset = dataindexlist[i];
            if (msgoffset + subitemoffset >= dv.byteLength) continue;

            const value = rf(dv, msgoffset + subitemoffset);
            ds.y.push(value);

            if (timerf && timesuboff != null && msgoffset + timesuboff < dv.byteLength) {
                const rawTime = timerf(dv, msgoffset + timesuboff);
                const timeMs = isTimeUS
                    ? (typeof rawTime === 'bigint' ? Number(rawTime / 1000n) : Number(rawTime) / 1000)
                    : Number(rawTime);

                if (this.boot_time_ms_since_epoch > 0) {
                    ds.x.push(new Date(this.boot_time_ms_since_epoch + timeMs));
                } else {
                    ds.x.push(timeMs / 1000); // Relative seconds
                }
            } else {
                ds.x.push(i); // Index fallback
            }
        }
        return ds;
    }

    get_gps_series() {
        const gpstypeval = this.msgtype_name_hash["GPS"];
        if (gpstypeval == null) return null;
        const msgt = this.msgtypes[gpstypeval];
        if (!msgt) return null;

        const ds = {
            name: "GPS",
            lat: [],
            lon: [],
            alt: [],
            time: [],
            vel: [],
            status: []
        };

        const latsubidx = msgt.subitemidx_from_name["Lat"];
        const lonsubidx = msgt.subitemidx_from_name["Lng"];
        const altsubidx = msgt.subitemidx_from_name["Alt"];
        const velsubidx = msgt.subitemidx_from_name["Spd"];
        const timesubidx = msgt.subitemidx_from_name["TimeUS"] !== undefined ? msgt.subitemidx_from_name["TimeUS"] : msgt.subitemidx_from_name["TimeMS"];
        const statusidx = msgt.subitemidx_from_name["Status"];

        if (latsubidx == null || lonsubidx == null) return null;

        const latoffset = msgt.subitemoffset[latsubidx];
        const lonoffset = msgt.subitemoffset[lonsubidx];
        const altoffset = altsubidx != null ? msgt.subitemoffset[altsubidx] : null;
        const veloffset = velsubidx != null ? msgt.subitemoffset[velsubidx] : null;
        const timeoffset = timesubidx != null ? msgt.subitemoffset[timesubidx] : null;
        const statusoffset = statusidx != null ? msgt.subitemoffset[statusidx] : null;

        const latlonrf = readfunc[msgt.fields[latsubidx]] || ((dv, off) => dv.getInt32(off, true) / 10000000.0);
        const altrf = altoffset != null ? (readfunc[msgt.fields[altsubidx]] || readfunc['f']) : null;
        const velrf = veloffset != null ? (readfunc[msgt.fields[velsubidx]] || readfunc['f']) : null;
        const statusrf = statusoffset != null ? (readfunc[msgt.fields[statusidx]] || readfunc['B']) : null;
        const timerf = timeoffset != null ? (readfunc[msgt.fields[timesubidx]] || readfunc['Q']) : null;

        const dv = new DataView(this.buffer);
        let dataindexlist = [];
        if (msgt.with_instances) {
            dataindexlist = (msgt.data[0] || (msgt.data.length > 0 ? msgt.data.find(d => d && d.length) : null)) || [];
        } else {
            dataindexlist = msgt.data || [];
        }

        if (dataindexlist.length === 0) return null;

        // Some older/generated logs contain a valid payload but incorrect FMT field widths.
        // Select the nearby coordinate offset that yields the most complete, continuous track.
        const decodeCoordinate = (offset) => {
            let value = latlonrf(dv, offset);
            if (Math.abs(value) > 180) value /= 10000000;
            return value;
        };
        let coordinateShift = 0;
        let bestScore = Infinity;
        for (let shift = -4; shift <= 4; shift++) {
            const points = [];
            for (let index = 0; index < Math.min(dataindexlist.length, 50); index++) {
                const offset = dataindexlist[index];
                if (offset + latoffset + shift < 0 || offset + lonoffset + shift + 4 > dv.byteLength) continue;
                const lat = decodeCoordinate(offset + latoffset + shift);
                const lon = decodeCoordinate(offset + lonoffset + shift);
                if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) points.push({ lat, lon });
            }
            if (points.length < 2) continue;
            const distances = [];
            for (let index = 1; index < points.length; index++) distances.push(gps_coord_distance(points[index - 1], points[index]));
            distances.sort((a, b) => a - b);
            const median = distances[Math.floor(distances.length / 2)] || 0;
            const missingPenalty = (Math.min(dataindexlist.length, 50) - points.length) * 1000000;
            const score = median + missingPenalty + Math.abs(shift) * .01;
            if (score < bestScore) { bestScore = score; coordinateShift = shift; }
        }

        let latcen = 0.0, loncen = 0.0;
        let validCount = 0;
        let latmin = 90.0, latmax = -90.0;
        let lonmin = 180.0, lonmax = -180.0;
        let altmin = 99999.0, altmax = -99999.0;
        let velmax = 0.0;

        for (let i = 0; i < dataindexlist.length; i++) {
            const msgoffset = dataindexlist[i];
            if (msgoffset + latoffset >= dv.byteLength || msgoffset + lonoffset >= dv.byteLength) continue;

            let lat = latlonrf(dv, msgoffset + latoffset + coordinateShift);
            let lon = latlonrf(dv, msgoffset + lonoffset + coordinateShift);
            // Older/self-generated FMT rows sometimes declare raw E7 coordinates as int32 instead of L.
            if (Math.abs(lat) > 90) lat /= 10000000;
            if (Math.abs(lon) > 180) lon /= 10000000;
            const status = (statusrf && msgoffset + statusoffset < dv.byteLength) ? statusrf(dv, msgoffset + statusoffset) : 3;

            if ((lat === 0 && lon === 0) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

            ds.lat.push(lat);
            ds.lon.push(lon);
            ds.status.push(status);

            latmin = Math.min(latmin, lat);
            latmax = Math.max(latmax, lat);
            lonmin = Math.min(lonmin, lon);
            lonmax = Math.max(lonmax, lon);
            latcen += lat;
            loncen += lon;
            validCount++;

            if (altrf && altoffset != null && msgoffset + altoffset + coordinateShift < dv.byteLength) {
                const alt = altrf(dv, msgoffset + altoffset + coordinateShift);
                if (Number.isFinite(alt) && Math.abs(alt) < 100000) {
                    ds.alt.push(alt);
                    altmin = Math.min(altmin, alt);
                    altmax = Math.max(altmax, alt);
                } else ds.alt.push(0);
            }

            if (velrf && veloffset != null && msgoffset + veloffset + coordinateShift < dv.byteLength) {
                const vel = velrf(dv, msgoffset + veloffset + coordinateShift);
                ds.vel.push(vel);
                velmax = Math.max(velmax, vel);
            }

            if (timerf && timeoffset != null && msgoffset + timeoffset < dv.byteLength) {
                const rawTime = timerf(dv, msgoffset + timeoffset);
                const timeMs = typeof rawTime === 'bigint' ? Number(rawTime / 1000n) : Number(rawTime) / 1000;
                ds.time.push(this.boot_time_ms_since_epoch > 0 ? new Date(this.boot_time_ms_since_epoch + timeMs) : timeMs / 1000);
            }
        }

        if (validCount === 0) return null;

        ds.latmin = latmin;
        ds.latmax = latmax;
        ds.lonmin = lonmin;
        ds.lonmax = lonmax;
        ds.altmin = altmin;
        ds.altmax = altmax;
        ds.velmax = velmax;
        ds.cenlat = latcen / validCount;
        ds.cenlon = loncen / validCount;
        return ds;
    }

    get_boot_time() {
        return this.boot_time_ms_since_epoch;
    }
}

/* ArduPilot's exported text DataFlash format (.log). FMT rows describe every later CSV row. */
class textlogfile {
    constructor(buffer, progressCallback = null) {
        this.buffer = buffer;
        this.msgtypes = {};
        this.msgtype_name_hash = {};
        this.records = [];
        this.totalMessages = 0;
        this.parse(progressCallback);
        this.boot_time_ms_since_epoch = this.find_timebase();
    }

    parse(progressCallback) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(this.buffer);
        const lines = text.split(/\r?\n/);
        const formats = new Map();
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (progressCallback && lineIndex % 4000 === 0) progressCallback(lineIndex / Math.max(1, lines.length));
            const parts = lines[lineIndex].split(',').map(value => value.trim());
            if (!parts[0]) continue;
            if (parts[0] === 'FMT' && parts.length >= 6) {
                const name = parts[3];
                const columns = parts.slice(5).join(',');
                const subitemlist = columns.split(',').map(value => value.trim()).filter(Boolean);
                const subitemidx_from_name = Object.fromEntries(subitemlist.map((field, index) => [field, index]));
                const type = parts[1] || name;
                const format = { type, length: Number(parts[2]) || 0, name, fields: parts[4], columns,
                    subitemlist, subitemidx_from_name, subitemoffset: subitemlist.map((_, index) => index),
                    with_instances: false, data: [] };
                formats.set(name, format); this.msgtypes[type] = format; this.msgtype_name_hash[name] = type;
                continue;
            }
            const format = formats.get(parts[0]);
            if (!format) continue;
            const values = {};
            format.subitemlist.forEach((field, index) => {
                const raw = parts[index + 1];
                if (raw == null) return;
                const numeric = Number(raw);
                values[field] = raw !== '' && Number.isFinite(numeric) ? numeric : raw;
            });
            const rawTimestamp = values.TimeUS ?? values.TimeMS;
            const timestampMs = Number(rawTimestamp) / (values.TimeUS != null ? 1000 : 1);
            if (!Number.isFinite(timestampMs)) continue;
            const record = { name: format.name, instance: Number.isFinite(Number(values.Instance ?? values.I)) ? Number(values.Instance ?? values.I) : null, timestampMs, values };
            format.data.push(this.records.length); this.records.push(record); this.totalMessages++;
        }
        this.records.sort((a, b) => a.timestampMs - b.timestampMs);
        if (progressCallback) progressCallback(1);
    }

    to_snapshot() { return { msgtypes: this.msgtypes, msgtype_name_hash: this.msgtype_name_hash, records: this.records,
        totalMessages: this.totalMessages, boot_time_ms_since_epoch: this.boot_time_ms_since_epoch, text: true }; }
    static from_snapshot(buffer, snapshot) { const value = Object.create(textlogfile.prototype); Object.assign(value, snapshot, { buffer }); return value; }
    get_msgitem_list() { return Object.values(this.msgtypes).sort((a, b) => a.name.localeCompare(b.name)); }
    get_records(_progressCallback = null, allowedNames = null, sampleIntervalsMs = null) {
        if (!this.records.length) throw new Error('No timestamped DataFlash rows were found in this text log.');
        const lastSampleAt = new Map();
        return this.records.filter(record => {
            if (allowedNames && !allowedNames.has(record.name)) return false;
            const interval = sampleIntervalsMs?.[record.name];
            if (!interval) return true;
            const key = `${record.name}:${record.instance ?? 0}`;
            const previousTimestamp = lastSampleAt.get(key);
            if (previousTimestamp != null && record.timestampMs >= previousTimestamp && record.timestampMs - previousTimestamp < interval) return false;
            lastSampleAt.set(key, record.timestampMs);
            return true;
        });
    }
    find_timebase() {
        const gps = this.records.find(record => record.name === 'GPS' && Number(record.values.GWk) > 1000 && Number.isFinite(Number(record.values.GMS)));
        return gps ? Date.UTC(1980, 0, 6) + Number(gps.values.GWk) * 604800000 + Number(gps.values.GMS) - gps.timestampMs : 0;
    }
    get_boot_time() { return this.boot_time_ms_since_epoch; }
    get_data_series(item, instance, field) {
        const rows = this.records.filter(record => record.name === item && (instance < 0 || record.instance === instance) && Number.isFinite(Number(record.values[field])));
        if (!rows.length) return null;
        return { name: `${item}${instance >= 0 ? instance : ''}.${field}`, x: rows.map(record => this.boot_time_ms_since_epoch > 0 ? new Date(this.boot_time_ms_since_epoch + record.timestampMs) : record.timestampMs / 1000),
            y: rows.map(record => Number(record.values[field])), type: 'scatter', mode: 'lines', line: { width: 1.8 } };
    }
    get_gps_series() {
        const rows = this.records.filter(record => record.name === 'GPS' && Number.isFinite(Number(record.values.Lat)) && Number.isFinite(Number(record.values.Lng)) && (Number(record.values.Lat) !== 0 || Number(record.values.Lng) !== 0));
        if (!rows.length) return null;
        const ds = { name: 'GPS', lat: rows.map(row => Number(row.values.Lat)), lon: rows.map(row => Number(row.values.Lng)), alt: rows.map(row => Number(row.values.Alt) || 0),
            time: rows.map(row => this.boot_time_ms_since_epoch > 0 ? new Date(this.boot_time_ms_since_epoch + row.timestampMs) : row.timestampMs / 1000),
            vel: rows.map(row => Number(row.values.Spd) || 0), status: rows.map(row => Number(row.values.Status) || 0) };
        ds.cenlat = ds.lat.reduce((a, b) => a + b, 0) / ds.lat.length; ds.cenlon = ds.lon.reduce((a, b) => a + b, 0) / ds.lon.length;
        ds.altmin = Math.min(...ds.alt); ds.altmax = Math.max(...ds.alt); ds.velmax = Math.max(...ds.vel); return ds;
    }
}
