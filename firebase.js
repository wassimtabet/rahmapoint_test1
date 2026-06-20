// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCUrMrLy-bFPOT9YCglSWZTFxcusnsctJQ",
  authDomain: "rahma-point.firebaseapp.com",
  projectId: "rahma-point",
  storageBucket: "rahma-point.firebasestorage.app",
  messagingSenderId: "169407709238",
  appId: "1:169407709238:web:aa822072edee91b9d01897",
  measurementId: "G-DD05YNHGDE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
