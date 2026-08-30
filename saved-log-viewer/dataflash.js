/* SkyForge ArduPilot Dataflash Parser
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
    constructor(buffer) {
        this.buffer = buffer;
        this.msgtypes = {};
        this.msgtype_name_hash = {};
        this.totalMessages = 0;
        this.parse();
        this.boot_time_ms_since_epoch = this.find_timebase();
    }

    parse() {
        const dv = new DataView(this.buffer);
        const len = dv.byteLength;

        for (let idx = 0; idx < len - 3;) {
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
    }

    get_msgitem_list() {
        const list = Object.values(this.msgtypes).filter(m => m && m.name);
        return list.sort((a, b) => a.name.localeCompare(b.name));
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

        let latcen = 0.0, loncen = 0.0;
        let validCount = 0;
        let latmin = 90.0, latmax = -90.0;
        let lonmin = 180.0, lonmax = -180.0;
        let altmin = 99999.0, altmax = -99999.0;
        let velmax = 0.0;

        for (let i = 0; i < dataindexlist.length; i++) {
            const msgoffset = dataindexlist[i];
            if (msgoffset + latoffset >= dv.byteLength || msgoffset + lonoffset >= dv.byteLength) continue;

            const lat = latlonrf(dv, msgoffset + latoffset);
            const lon = latlonrf(dv, msgoffset + lonoffset);
            const status = (statusrf && msgoffset + statusoffset < dv.byteLength) ? statusrf(dv, msgoffset + statusoffset) : 3;

            if (lat === 0 && lon === 0) continue; // Filter unset coordinates

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

            if (altrf && altoffset != null && msgoffset + altoffset < dv.byteLength) {
                const alt = altrf(dv, msgoffset + altoffset);
                ds.alt.push(alt);
                altmin = Math.min(altmin, alt);
                altmax = Math.max(altmax, alt);
            }

            if (velrf && veloffset != null && msgoffset + veloffset < dv.byteLength) {
                const vel = velrf(dv, msgoffset + veloffset);
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
