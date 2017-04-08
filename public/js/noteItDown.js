var NoteItDown = function(options, elasticlunr){
  "use strict";

  let $noteContainerId = options.noteContainerId || 'note-it-down';
  let $signInStatusLabelId = options.signInStatusLabelId || 'nid-sign-in-status';
  let $signInButtonId = options.signInButtonId || 'nid-sign-in';
  let $dataStatusLabelId = options.dataStatusLabelId || 'nid-data-status';
  let $newNoteButtonId = options.newNoteButtonId || 'nid-new-note';
  let $notesListId = options.notesListId || 'nid-notes-list';
  let $noteItemClass = options.noteItemClass || 'nid-note-item';
  let $searchResultsListId = options.searchResultsListId || 'nid-search-results-list';
  let $searchBoxId = options.searchBoxId || 'search-box';

  let noteNameLength = 22;
  let fireDb = firebase.database();
  let uid = null;
  let currentNote = null;
  let elunrIndex = null;

  /**
   * Returns a function, that, as long as it continues to be invoked, will not
   * be triggered. The function will be called after it stops being called for
   * N milliseconds. If `immediate` is passed, trigger the function on the
   * leading edge, instead of the trailing.
   */
  function debounce(func, wait, immediate) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  }

  /**
   * Function called when clicking the Login/Logout button.
   */
  function toggleSignIn() {
    if (!firebase.auth().currentUser) {

      let provider = new firebase.auth.GoogleAuthProvider();

      provider.addScope('https://www.googleapis.com/auth/plus.login');

      firebase.auth().signInWithPopup(provider).then(function(result) {
        // This gives you a Google Access Token. You can use it to access the Google API.
        let token = result.credential.accessToken;
        // The signed-in user info.
        let user = result.user;
      }).catch(function(error) {
        // Handle Errors here.
        let errorCode = error.code;
        let errorMessage = error.message;
        // The email of the user's account used.
        let email = error.email;
        // The firebase.auth.AuthCredential type that was used.
        let credential = error.credential;

        if (errorCode === 'auth/account-exists-with-different-credential') {
          alert('You have already signed up with a different auth provider for that email.');
          // If you are using multiple auth providers on your app you should handle linking
          // the user's accounts here.
        } else {
          console.error(error);
        }

      });

    } else {
      firebase.auth().signOut();
    }
    document.getElementById($signInButtonId).disabled = true;

  }

  /**
   * Function for getting reference to note with given key
   */
  function getNoteRef(noteKey){
    return fireDb.ref(`notes/${noteKey}`);
  }

  /**
   * Function for getting reference to note with given key from user's notes list
   */
  function getUserNoteRef(noteKey, uid){
    return fireDb.ref(`users/${uid}/notes/${noteKey}`);
  }

  /**
   * Function for updating current user's lastNote
   */
  function updateLastNote(noteKey, uid){
    return fireDb.ref(`users/${uid}`).update({
      lastNote: noteKey
    });
  }

  /**
   * Function called for initializing a note at given ref for current user
   */
  function initNote(noteKey, uid){
    let noteRef = getNoteRef(noteKey);

    // Create CodeMirror (with lineWrapping on) - after ensuring the container is empty.
    let noteContainer = document.getElementById($noteContainerId);
    noteContainer.innerHTML = "";
    let codeMirror = CodeMirror(noteContainer, { lineWrapping: true });

    // Create Firepad (with rich text toolbar and shortcuts enabled).
    let note = Firepad.fromCodeMirror(noteRef, codeMirror,
      { richTextShortcuts: true, richTextToolbar: true,
        defaultText: 'Start noting things down...',
        'userId' : uid });

    currentNote = note;

    //Remove Firepad logo
    document.getElementsByClassName('powered-by-firepad')[0].outerHTML='';

    note.on('ready', () => {
      //Update status
      document.getElementById($dataStatusLabelId).textContent = 'Data synced.';

      //Setup note update event handler
      noteRef.child('history').limitToLast(1).on('child_added', (snapshot) => {
        //Content for note changed, update note name if beginning of note changed
        if(snapshot.val().o[0] < noteNameLength){
          noteRef.update({ name: `${note.getText().substr(0, noteNameLength).replace(/\n/g, ' ')}...` });
        }
        //Set last modified date in user's notes list
        getUserNoteRef(noteRef.key, uid).set(-1 * snapshot.val().t);  //*-1 because Firebase doesn't allow sorting in desc

        //Required to ensure name and order change reflects in list of notes
        debounce(initNotesList, 500)(noteRef.key, uid);

        //Update search index
        indexForSearch(noteRef.key, uid);

      });

      //Focus on the note and set cursor to end of any text in the note
      codeMirror.focus();
      //Commenting this out because this setting cursor to the end feels a bit annoying
      //codeMirror.setCursor(codeMirror.lineCount(), 0);
    });

    let nidSynced = true;

    note.on('synced', function(isSynced) {
      // isSynced will be false immediately after the user edits the pad,
      // and true when their edit has been saved to Firebase.
      if(nidSynced != isSynced){
        if(isSynced){
          document.getElementById($dataStatusLabelId).textContent = 'Data synced.';
        }else{
          document.getElementById($dataStatusLabelId).textContent = 'Syncing...';
        }
        nidSynced = isSynced;
      }
    });

    updateLastNote(noteKey, uid);

    //Cancel Firepad's onDisconnect behavior that deletes users
    fireDb.ref(`notes/${noteKey}/users`).onDisconnect().cancel();

    return noteRef;
  }

  /**
   * Function called for creating and initializing a new note
   */
  function createNewNote(){
    //Create a new Firepad at /notes/$noteId
    let noteRef = fireDb.ref('notes').push();

    updateLastNote(noteRef.key, uid).then(() => {
      getUserNoteRef(noteRef.key, uid).set(Date.now());
    });

    //Initialize it
    initNote(noteRef.key, uid);

    return noteRef;
  }

  /**
   * Function for adding a note to the notes list (sidebar)
   */
  function addToNotesList(userNoteRef, notesListId = $notesListId, isHighlighted){
    let notesList = document.getElementById(notesListId);
    let noteItem = document.createElement('li');
    noteItem.className += $noteItemClass;
    noteItem.dataset.key = userNoteRef.key;

    if(isHighlighted){
      noteItem.className += ' selected-note';
    }

    noteItem.addEventListener('click', (e) => {
      if(currentNote){
        currentNote.dispose();
      }
      return initNote(e.target.dataset.key, uid);
    }, false);

    notesList.appendChild(noteItem);

    //Setup note name update handler
    getNoteRef(userNoteRef.key).child('name').on('value', (snapshot) => {
      if(snapshot.val()){
        notesList.querySelector(`[data-key='${userNoteRef.key}']`).innerText = snapshot.val();
      }
    });

  }

  /**
   * Function for fetching and rendering list of user's notes
   */
  function initNotesList(highlightNoteKey, uid){
    if(uid){
      let userNotesRef = fireDb.ref(`users/${uid}/notes`);
      let notesList = document.getElementById($notesListId);
      notesList.innerHTML = '';

      userNotesRef.orderByValue().on('child_added', (userNoteRef) => {
        addToNotesList(userNoteRef, $notesListId, highlightNoteKey == userNoteRef.key);
      });
    }
  }

  function indexForSearch(noteKey, uid) {
    let headless = new Firepad.Headless(fireDb.ref(`notes/${noteKey}`));
    headless.getText((text) => {
      elunrIndex.updateDoc({
        'noteRef': noteKey,
        'noteText': text
      }, false);
      headless.dispose();

      //Store the index in Firebase
      fireDb.ref(`users/${uid}/searchIndex`).set(JSON.stringify(elunrIndex.toJSON()));
    });
  }

  /**
   * initApp handles setting up UI event listeners and registering Firebase auth listeners:
   *  - firebase.auth().onAuthStateChanged: This listener is called when the user is signed in or
   *    out, and that is where we update the UI.
   */
  function initApp() {
    // Listening for auth state changes.
    firebase.auth().onAuthStateChanged(function(user) {
      if (user) {
        // User is signed in.
        let displayName = user.displayName;
        let email = user.email;
        let emailVerified = user.emailVerified;
        let photoURL = user.photoURL;
        let isAnonymous = user.isAnonymous;
        let providerData = user.providerData;
        uid = user.uid;

        document.getElementById($signInStatusLabelId).textContent = `Signed in as ${displayName}`;
        document.getElementById($signInButtonId).value = 'Sign out';

        document.getElementById($dataStatusLabelId).textContent = 'Syncing your data now...';

        let noteRef = null;

        //Find uid in users
        let nidUser = null;
        fireDb.ref(`users/${uid}`).once('value').then(snapshot => {
          nidUser = snapshot.val();

          //If user is found
          if (nidUser) {
            //Retrieve lastNote or note that was created most recently
            if (nidUser.lastNote) {
              noteRef = getNoteRef(nidUser.lastNote);
            } else {
              //Create a new Firepad at /notes/$noteId
              noteRef = fireDb.ref('notes').push();
            }

          } else {
            //Create new note for user
            noteRef = createNewNote();

          }

          initNote(noteRef.key, uid);

          //Setup event listeners on user data
          fireDb.ref(`users/${uid}/lastNote`).on('value', (snapshot) => {
            initNotesList(snapshot.val(), uid);
          });

          document.getElementById($newNoteButtonId).disabled = false;

          //Get or create search index
          fireDb.ref(`users/${uid}/searchIndex`).on('value', (snapshot) => {
            if(snapshot.val()){
              //Set the index
              elunrIndex = elasticlunr.Index.load(JSON.parse(snapshot.val()));

              //Wire up search
              let notesList = document.getElementById($notesListId);
              let searchResultsList = document.getElementById($searchResultsListId);
              let searchBox = document.getElementById($searchBoxId);
              searchBox.addEventListener('keyup', debounce((e) => {
                let searchStr = e.target.value.trim();
                if(searchStr.length > 1){
                  let results = elunrIndex.search(searchStr, {
                    expand: true
                  });
                  notesList.style.display = 'none';
                  searchResultsList.innerHTML = '';
                  searchResultsList.style.display = 'block';
                  results.forEach((result) => {
                    addToNotesList(fireDb.ref(`users/${uid}/notes/${result.ref}`), $searchResultsListId,
                      currentNote.firebaseAdapter_.ref_.key == result.ref);
                  });
                }else{
                  notesList.style.display = 'block';
                  searchResultsList.style.display = 'none';
                  initNotesList(currentNote.firebaseAdapter_.ref_.key, uid);
                }
              }, 500));
            }else{
              //Create new index
              elunrIndex = elunrIndex || elasticlunr(function(){
                this.addField('noteText');
                this.setRef('noteRef');
              });
              //For each of the user's notes
              fireDb.ref(`users/${uid}/notes`).on('child_added', (snapshot) => {
                indexForSearch(snapshot.key, uid);
              });
            }
          });
        });

      } else {
        // User is signed out.
        document.getElementById($signInStatusLabelId).textContent = 'Signed out';
        document.getElementById($signInButtonId).value = 'Sign in with Google';
        document.getElementById($noteContainerId).innerHTML = '';
        document.getElementById($notesListId).innerHTML = '';
        document.getElementById($dataStatusLabelId).innerHTML = '';
        document.getElementById($newNoteButtonId).disabled = true;
        uid = null;
      }
      document.getElementById($signInButtonId).disabled = false;

    });

    document.getElementById($signInButtonId).addEventListener('click', toggleSignIn, false);
    document.getElementById($newNoteButtonId).addEventListener('click', createNewNote, false);
  }

  return {
    init: initApp
  };
};