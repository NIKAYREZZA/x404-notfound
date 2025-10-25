// generate-key.js - optional local helper to create a new wallet (node)
import { ethers } from "ethers";
const wallet = ethers.Wallet.createRandom();
console.log("Address:", wallet.address);
console.log("Private Key:", wallet.privateKey);
