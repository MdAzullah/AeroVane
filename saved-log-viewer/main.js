/* SearchWing LogViewer
   Copyright 2022 Friedrich Beckmann

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version. */

function readfiles(files) {
    if (!files || files.length === 0) return;
    if (!is_dataflash(files[0].name)) {
        alert("Please select a valid ArduPilot dataflash (.bin or .log) file.");
        return;
    }
    const uploadpage = document.getElementById('uploadpage');
    if (uploadpage) uploadpage.style.display = "none";
    const analyzepage = document.getElementById('analyzepage');
    if (analyzepage) analyzepage.style.display = "block";

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            console.log("Parsing log file...");
            const buffer = event.target.result;
            const lf = new logfile(buffer);
            document.logfile = lf;
            build_navbar(lf.get_msgitem_list());

            const plot = document.getElementById('plot');
            const layout = {
                yaxis1: { side: 'left' },
                yaxis2: { side: 'left', overlaying: 'y', position: 0.15 },
                yaxis3: { side: 'right', overlaying: 'y', position: 0.85 },
                yaxis4: { side: 'right', overlaying: 'y' }
            };

            let ds = null;
            if (lf.msgtype_name_hash && lf.msgtype_name_hash["BARO"] != null) {
                ds = lf.get_data_series("BARO", 0, "Alt");
            }
            if (ds) {
                ds.name = ds.name + ":y";
                Plotly.newPlot(plot, [ds], layout);
                add_trace_to_plotctrl(ds);
            } else {
                Plotly.newPlot(plot, [], layout);
            }

            if (lf.msgtype_name_hash && lf.msgtype_name_hash["GPS"] != null) {
                const gpsds = lf.get_gps_series();
                if (gpsds && gpsds.lat && gpsds.lat.length > 0) {
                    draw_flight_map(gpsds);
                    get_overview(gpsds, lf.get_boot_time());
                }
            }
        } catch (err) {
            console.error("Error reading logfile:", err);
            alert("Error parsing logfile: " + err.message);
        }
    };
    reader.readAsArrayBuffer(files[0]);
}

function handle_ondrop(event) {
    event.preventDefault();
    console.log(event.dataTransfer.files);
    readfiles(event.dataTransfer.files);
    console.log("Hallo");
};

function handle_dragover(event) {
    /* Only when the default handler is prevented, the
       element is considered an allowed drop target */
    event.dataTransfer.dropEffect = 'copy';
    event.preventDefault();
};

function handle_dragenter(event) {
    event.preventDefault();
};

function handle_onfilechange(event) {
    console.log("File here!" + event.currentTarget.files[0].name);
    readfiles(event.currentTarget.files);
}

/** Check the filename ending if this a dataflash file. The
 *  mimetype does not help here because there is no unique mimetype
 *  for the dataflash file. So we just check the file extension.
 */
function is_dataflash(fname) {
    if (!fname) return false;
    const fileextension = fname.split(".").pop();
    const ext = fileextension ? fileextension.toLowerCase() : "";
    return ext === "bin" || ext === "log";
}

function on_trace_remove(event) {
    plot = document.getElementById('plot');
    Plotly.deleteTraces('plot',0);

}

function upload_click(event) {
    uploadpage = document.getElementById('uploadpage');
    uploadpage.style.display="initial";
    analyzepage = document.getElementById('analyzepage');
    analyzepage.style.display="none";
}

function on_ulSend() {
    let logfile = document.getElementById("fileToUpload").files[0];
    let locationname = document.getElementById("ulLocation").value;
    console.log("Hallo Click");
    const chunksize = 1000000;
    let chunknr = 0;
    for(let filepos = 0;filepos < logfile.size;filepos += chunksize) {
        const chunk = logfile.slice(filepos, filepos + chunksize);
        const formData = new FormData();
        formData.append("fileToUpload", chunk, logfile.name + chunknr++);
        let xhr = new XMLHttpRequest();
        xhr.onreadystatechange = state => {console.log("Status", xhr.status); };
        xhr.timeout = 5000;
        xhr.open("POST", 'upload.php');
        xhr.send(formData);
    }
}

function on_ulSend_onefile() {
    let logfile = document.getElementById("fileToUpload").files[0];
    let locationname = document.getElementById("ulLocation").value;
    console.log("Hallo Click");
    let formData = new FormData();
    formData.append("fileToUpload", logfile);
    formData.append("location", locationname);

    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = state => {console.log("Status", xhr.status); };
    xhr.timeout = 5000;
    xhr.open("POST", 'upload.php');
    xhr.send(formData);
}