const CLIENT_ID = "1068107389496-sapmb6nh9l85vccdke6ju2jsbv5ibs51.apps.googleusercontent.com"; // Client ID from https://console.developers.google.com
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]; // The nexessary API scopes
const MIME = "application/vnd.google-apps.spreadsheet";

/** Quickly select HTML elements using a CSS selector */
const q = s => document.querySelector(s);
/** Get an array with length N where each value equals its index */
const range = N => Array(N).fill().map((_, i) => i);

/** @type {Array} CSS selectors for all the components (elements that should not be visible at the same time) */
const COMPONENTS = ["#result-view", "form#update", "form#losetimer", "pre#output"];
/** Make all component selectors available as constants */
const [RESULT, UPDATE, LOSETIMER, PRE] = COMPONENTS;
/** Displays the component with the given key if one is provided, returns an array of active components otherwise */
const show = key =>
  key
    ? COMPONENTS.forEach(id => (q(id).style.display = key === id ? "block" : "none"))
    : COMPONENTS.filter(id => q(id).style.display === "block");

/**
 * Info regarding the current version of the spreadsheet @type {Object}
 * Properties (? marks optional):
 *   {String} key          A string of random words only found in that spreadsheet
 *   {String} title        The name the spreadsheet will get in the user's Drive
 *   {String} template     The drive id for the public template
 *   {String} range        The range where days, hours and extra can be found
 *   {Array<number>} days  The vertical and horizontal position of days in the range, respectively
 *   {Array<number>} hours The vertical and horizontal position of hours in the range, respectively
 *   {Array<number>} extra The vertical and horizontal position of extra hours in the range, respectively
 *   {?String} losetimer   Range with information about løse studietimer
 */
const VERSION = {
  key: "tnjioe0fh34j9",
  title: "Plusstimer høst 2018 (versjon 2)",
  template: "1xxb6kZ8qfcaK123nFBmwRFlq37ffipWKVyvXDpUdC3E",
  range: "Plusstimer!D7:G7",
  days: [0, 0],
  hours: [0, 1],
  extra: [0, 2],
  plusstimer: [0, 3],
  losetimer: "Plusstimer!L16:O20",
};

/**
 * Array of objects with info about previous versions of spreadsheets from the same semester as the current version @type {Array<Object>}
 * Each object can have the same properties as a VERSION object, but only `key` and `range` is required.
 */
const COMPATIBLE_VERSIONS = [
  {
    key: "Version sq33hhst18uu",
    title: "Plusstimer høst 2018",
    range: "Plusstimer!D7:G7",
    days: [0, 0],
    hours: [0, 1],
    extra: [0, 2],
  },
];

/** Array of keywords in old and outdated spreadsheets created by this web app that should be trashed */
const INCOMPATIBLE_VERSIONS = [
  "Plusstimer 2017 høst Panda Bever",
  "Plusstimer 2017 høst Ulv Rotte",
  "Plusstimer 2018 vår gfxksll",
];

/** Check if current user has authorized this application. */
function checkAuth() {
  const timeout = setTimeout(apiLoadErr, 5000);
  gapi.auth.authorize(
    {
      client_id: CLIENT_ID,
      scope: SCOPES.join(" "),
      immediate: true,
    },
    result => (q("#authorize-div").style.display = "block", handleAuthResult(result), clearTimeout(timeout))
  );
}

/** Initiate auth flow in response to user clicking authorize button. */
function handleAuthClick() {
  gapi.auth.authorize({ client_id: CLIENT_ID, scope: SCOPES, immediate: false }, handleAuthResult);
}


/**
 * Append text to the pre element containing the given message.
 * @param {string} message Text to be placed in pre element.
 * @param {boolean} error Whether or not the message is an error
 */
function log(message, error = false) {
  if (error) {
    show(PRE);
    q("pre").innerHTML = `<h4 class="error">${message}</h4>`;
  }
  console.log(message);
}
/** Clears the pre element and adds a loading icon to it */
function showLoading() {
  show(PRE);
  q(PRE).innerHTML = `<img id="loading" src="img/loading.svg">`;
}

/**
 * Handle response from authorization server.
 * @param {Object} authResult Authorization result.
 */
function handleAuthResult(authResult) {
  if (authResult && !authResult.error) {
    showLoading();
    loadGDriveApi(); // Load client library
  }
}

/** Handle API load error */
function apiLoadErr() {
  log(
    "Det virker som om det er noe galt. Prøv å laste inn siden på nytt, eller å bruke mobilen eller en annen PC.",
    true
  );
}

/** Load Google Drive API library. */
function loadGDriveApi() {
  log("Laster inn...");
  gapi.client.load("drive", "v2", findFile);
}

/** Find the right file. */
function findFile() {
  log("Leter etter regnearket");
  gapi.client.drive.files
    .list({
      q: "fullText contains '" + VERSION.key + "'",
    })
    .execute(resp => {
      if (!resp.error) {
        trashIncompatibles();
        const sheetId = getID(resp.items);
        if (sheetId) {
          loadSheetsApi(fetchAndOutputData, sheetId, false);
          setEventListener(sheetId);
          if ("losetimer" in VERSION) {
            const link = q("#loselink");
            link.style.display = "block";
            link.querySelector("a").onclick = e=>(e.preventDefault(), renderLosetimer(sheetId));
          }
        }
      } else if (resp.error.code == 401) {
        checkAuth(); // Access token might have expired.
      } else {
        log("En feil oppsto: " + resp.error.message, true);
      }
    });
}

/**
 * Find ID of the right file or create a file if none exist and return ID
 * @param {Array} items Array of documents in user's Drive that match the search query
 */
function getID(items) {
  const match = items.find(item => item.mimeType === MIME && !item.labels.trashed);
  if (match) return match.id;
  else log("Oppretter regneark"), copyFile();
}

/**
 * Load Sheets API client library.
 * @param {Function} callback Function to execute after loading API.
 * @param {...*} args Arguments to send to callback function.
 */
function loadSheetsApi(callback, ...args) {
  gapi.client.load("https://sheets.googleapis.com/$discovery/rest?version=v4").then(response => {
    args.length ? callback(...args) : callback(response);
  });
}

/** Fetch and print the data */
function fetchAndOutputData(sheetId, autoShowForm = false) {
  log("Laster inn plusstimer");
  if (typeof sheetId === "string") {
    gapi.client.sheets.spreadsheets.values
      .get({
        spreadsheetId: sheetId,
        range: VERSION.range,
      })
      .then(response => {
        const range = response.result;
        // Validate response and print result
        if (range.values.length > 0) {
          if (!autoShowForm) show(RESULT);
          const [days, hours, extra, plusstimer] = ["days", "hours", "extra", "plusstimer"].map(
            key => range.values[VERSION[key][0]][VERSION[key][1]]
          );
          q("#result>.number").innerHTML = plusstimer;
          q(UPDATE)[0].value = days;
          q(UPDATE)[1].value = hours;
          q(UPDATE)[2].value = extra;
          q("#last-update").innerText = "";
          showExtraFormIf(extra > 0);
          displayLastEditDate(sheetId);
        } else {
          // Handle unsuccessful validation of response
          log("Fant ingen data.", true);
        }
        if (autoShowForm) renderLosetimer(sheetId, true);
      })
      .catch(response => {
        log("Feil: " + response.result.error.message, true);
      });
  } else {
    // Handle unsuccessful validation of the sheetId variable (this should never happen, but the user should get an explanation if it does)
    log("Noe gikk galt, vennligst last inn siden på nytt og prøv igjen", true);
  }
}

/** Get last edit date and display it in the result view */
function displayLastEditDate(sheetId) {
  gapi.client.drive.files
    .get({
      fileId: sheetId,
    })
    .execute(resp => {
      const dateStr = resp.modifiedDate;
      q("#last-update").innerText = `(Sist endret ${formatDate(dateStr)})`;
    });
}

/** Copy a spreadsheet file from public template because no existing file was found */
function copyFile() {
  gapi.client.drive.files
    .copy({
      fileId: VERSION.template,
      resource: { title: VERSION.title },
    })
    .execute(resp => {
      if (COMPATIBLE_VERSIONS.length) copyFromOldSheet(resp.id); // Check if any older, but compatible, versions of the current spreadsheet exists
      else loadSheetsApi(_ => renderLosetimer(resp.id, true));
      setEventListener(resp.id);
    });
}

/** Get data from old compatible spreadsheet and insert it into the new one */
function copyFromOldSheet(newSheetId) {
  if (!COMPATIBLE_VERSIONS.length) return renderLosetimer(newSheetId, true);
  log("Prøver å finne et gammelt regneark");
  gapi.client.drive.files
    .list({
      q: COMPATIBLE_VERSIONS.map(v => `fullText contains "${v.key}"`).join(" or "),
    })
    .execute(resp => {
      if (!resp.error) {
        const oldSheet = resp.items.find(item => item.mimeType === MIME && !item.labels.trashed);
        if (oldSheet) {
          log("Fant et gammelt regneark");
          const version = COMPATIBLE_VERSIONS.find(v => v.title === oldSheet.title) || COMPATIBLE_VERSIONS[0];
          loadSheetsApi(_ => {
            gapi.client.sheets.spreadsheets.values
              .get({
                // Get amount of days abscence
                spreadsheetId: oldSheet.id,
                range: version.range,
              })
              .then(resp => {
                // Update the new sheet with the variables from the old sheet
                const values = resp.result.values;
                const [days, hours, extra] = ["days", "hours", "extra"].map(key => version[key]).map(
                  coords => resp.result.values[coords[0]][coords[1]]
                );
                updateSheet(
                  newSheetId,
                  days,
                  hours,
                  extra,
                  true // Auto show form for updating lose timer TODO: get lose timer from old sheet instead
                );
                trashFile(oldSheet.id);
              });
          });
        } else renderLosetimer(newSheetId, true);
      } else renderLosetimer(newSheetId, true);
    });
}

/**
 * Move a file to the trash.
 * @param {String} fileId ID of the file to trash.
 */
function trashFile(fileId) {
  log("Flytter gammelt regneark til papirkurven");
  gapi.client.drive.files.trash({ fileId: fileId }).execute(resp => {
    if (resp.error) console.warn(resp.error, resp);
  });
}

/** Move all outdated files to trash */
function trashIncompatibles() {
  INCOMPATIBLE_VERSIONS.forEach(version => {
    gapi.client.drive.files
      .list({
        q: "fullText contains '" + version + "'",
      })
      .execute(resp =>
        resp.items
          .filter(item => item.mimeType == MIME && !item.labels.trashed)
          .map(item => item.id)
          .forEach(trashFile)
      );
  });
}

/*
 * Update spreadsheet
 * @param {string|number} days Amount of days abscence
 * @param {string|number} preset_hours Amount of hours abscence
 * @param {string|number} extra Extra school hours worked
 */
function updateSheet(sheetId, days, hours, extra, autoShowForm = false) {
  if (days && hours) {
    show(PRE);
    const values = [];
    ["days", "hours", "extra"].map(key => (values[VERSION[key][0]] = [], key))
      .forEach((key, i) => values[VERSION[key][0]][VERSION[key][1]] = [days, hours, extra][i]);
    log("Oppdaterer fravær");
    gapi.client.sheets.spreadsheets.values
      .update({
        spreadsheetId: sheetId,
        range: VERSION.range,
        valueInputOption: "USER_ENTERED",
        values: values,
      })
      .then(resp => {
        fetchAndOutputData(sheetId, autoShowForm);
      });
  } else {
    show(UPDATE);
  }
}

/** Handle update form submission */
function setEventListener(sheetId) {
  q(UPDATE).onsubmit = event => {
    event.preventDefault();
    updateSheet(sheetId, ...["days", "hours", "extra"].map(key => document.getElementsByName(key)[0].value));
  };
}

/**
 * If condition is true: shows the extra form, checks the "Yes" box and unchecks the "No" box.
 * Otherwise: the opposite happens.
 * @param {boolean} condition Whether or not the extra form should be shown
 */
function showExtraFormIf(condition) {
  q("#extra-div").style.display = condition ? "block" : "none";
  [...document.getElementsByName("show-extra")].forEach((checkbox, i) => (checkbox.checked = i == condition));
}

/** Listen for changes in checkbox */
["click", "keyup"].forEach(e =>
  q("#extra-form").addEventListener(e, event => {
    showExtraFormIf(q("#show-extra").checked);
    if (!q("#show-extra").checked) q(UPDATE).querySelector`[name="extra"]`.value = "";
  })
);

/** Render form that allows user to set when their løse studietimer is */
function renderLosetimer(sheetId, updateSheetAfterwards = false) {
  if ("losetimer" in VERSION) {
    showLoading();
    const form = q(LOSETIMER);
    form.onsubmit = event=>{
      event.preventDefault();
      const values = range(5)
        .map(i=>[...form.querySelectorAll(`[key="${i}"]`)].map(el=>el.value || el.innerText))
        .map(arr=>[arr[0], arr[1], ...arr[2].split(':')]);
      loadSheetsApi(_ => {
        showLoading();
        gapi.client.sheets.spreadsheets.values
          .update({
            spreadsheetId: sheetId,
            range: VERSION.losetimer,
            valueInputOption: "USER_ENTERED",
            values: values,
          })
          .then(_=>updateSheetAfterwards ? show(UPDATE) : fetchAndOutputData(sheetId))
          .catch(resp=>{
            log("Det oppsto en feil: "+resp.result.error.message+"\n\nLast inn siden på nytt for å prøve igjen.", true);
          });
      });
    };
    const selectTemplate = (dayData, i) =>`<select key="${i}">
      ${[":", "09:00", "09:45", "10:45", "11:30", "13:00", "13:45", "14:45", "15:30", "16:15"]
        .map(time => `<option value="${time}" ${dayData.slice(2).join`:`.replace(/^0/,'') === time.replace(/^0/,'') && "selected"}>${time !== ':' ? time : ''}</option>`) // TODO: The replace methods can be removed the next time VERSION is updated (currently at tnjioe0fh34j9)
        .join("")}
      </select>`;
    loadSheetsApi(_ => {
      gapi.client.sheets.spreadsheets.values
        .get({
          spreadsheetId: sheetId,
          range: VERSION.losetimer,
        })
        .then(resp => {
          show(LOSETIMER);
          form.querySelector(".grid-3").innerHTML = `
              <div>Ukedag</div>
              <div>Antall løse studietimer</div>
              <div>Når er studietimene ferdige?</div> `
            + resp.result.values
              .map((dayData, i) => `
                <div key="${i}">${dayData[0]}</div>
                <input key="${i}" name="amount" type="number" value="${dayData[1]}">
                ${selectTemplate(dayData, i)}`
              ).join("");
        });
    });
  } else show(RESULT);
}
