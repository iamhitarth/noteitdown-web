var NoteItDown = function(options){

  let $noteContainerId = options.noteContainerId || 'note-it-down';
  let $signInStatusLabelId = options.signInStatusLabelId || 'nid-sign-in-status';
  let $signInButtonId = options.signInButtonId || 'nid-sign-in';
  let $dataStatusLabelId = options.dataStatusLabelId || 'nid-data-status';
  let $newNoteButtonId = options.newNoteButtonId || 'nid-new-note';
  let $notesListId = options.notesListId || 'nid-notes-list';
  let $noteItemLinkClass = options.noteItemLinkClass || 'nid-note-item-link';
  let fireDb = firebase.database();
  let uid = null;

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

    //Remove Firepad logo
    document.getElementsByClassName('powered-by-firepad')[0].outerHTML='';

    note.on('ready', () => {
      //Update status
      document.getElementById($dataStatusLabelId).textContent = 'Data synced.';

      //Setup note update event handler
      noteRef.child('history').on('child_added', (snapshot) => {
        //Content for note changed, update note name if beginning of note changed
        if(snapshot.val().o[0] < 25){
          noteRef.update({ name: `${note.getText().substr(0, 20)}...` });
        }
      });

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

    return noteRef;
  }

  /**
   * Function called for creating and initializing a new note
   */
  function createNewNote(){
    //Create a new Firepad at /notes/$noteId
    let noteRef = fireDb.ref('notes').push();

    updateLastNote(noteRef.key, uid).then(() => {
      fireDb.ref(`users/${uid}/notes/${noteRef.key}`).set(true);
    });

    //Initialize it
    initNote(noteRef.key, uid);

    return noteRef;
  }

  /**
   * Function for fetching and rendering list of user's notes
   */
  function initNotesList(highlightNoteKey, uid){
    if(uid){
      let userNotesRef = fireDb.ref(`users/${uid}/notes`);
      let notesList = document.getElementById($notesListId);
      notesList.innerHTML = '';
      userNotesRef.on('child_added', (data) => {
        let noteItem = document.createElement('li');
        let noteLink = document.createElement('a');
        noteItem.className += 'nid-note-item';
        noteLink.className += 'nid-note-item-link';
        noteLink.href = '#';
        noteLink.innerText = data.key;
        noteItem.id = data.key;
        if(highlightNoteKey == data.key){
          noteItem.className += ' selected-note';
        }
        noteItem.appendChild(noteLink);
        noteItem.addEventListener('click', (e) => {
          return initNote(e.srcElement.innerText, uid);
        }, false);
        notesList.appendChild(noteItem);
      });
    }
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
            } else if (nidUser.notes && nidUser.notes.length > 0) {	// TODO Fix this as notes is not an array
              noteRef = getNoteRef(nidUser.notes.pop());
            } else {
              //Create a new Firepad at /notes/$noteId
              noteRef = fireDb.ref('notes').push();
            }

          } else {
            noteRef = createNewNote(fireDb, uid);

            //Add user to the users list
            fireDb.ref(`users/${uid}`).set({
              lastNote: noteRef.key
            }).then(() => {
              fireDb.ref(`users/${uid}/notes/${noteRef.key}`).set(true);
            });
          }

          initNote(noteRef.key, uid);

          //Setup event listeners on user data
          fireDb.ref(`users/${uid}/lastNote`).on('value', (snapshot) => {
            initNotesList(snapshot.val(), uid);
          });

          document.getElementById($newNoteButtonId).disabled = false;
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