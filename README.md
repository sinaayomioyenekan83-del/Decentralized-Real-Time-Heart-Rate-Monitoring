# ❤️ Decentralized Real-Time Heart Rate Monitoring

Welcome to a groundbreaking Web3 solution for healthcare! This project enables secure, real-time sharing of heart rate data from wearable devices to doctor apps via blockchain oracles on the Stacks network. It solves the real-world problem of centralized health data systems that are vulnerable to breaches, lack patient control, and struggle with real-time interoperability—empowering patients to own their data while ensuring doctors get timely, verifiable insights for better remote monitoring and early intervention.

## ✨ Features

🔒 Patient-owned data with encrypted storage and granular access control  
⏱️ Real-time heart rate feeds via trusted oracles from wearables (e.g., Fitbit, Apple Watch)  
📱 Seamless integration with doctor apps for alerts and dashboards  
🚨 Automated anomaly detection and emergency notifications  
✅ Data integrity verification using blockchain timestamps  
💰 Token-based incentives for data sharing and oracle providers  
🔄 Historical data querying with privacy-preserving proofs  
🛡️ Compliance-friendly design for health regulations (e.g., HIPAA-inspired privacy)

## 🛠 How It Works

This system uses the Stacks blockchain with Clarity smart contracts to create a decentralized ecosystem. Patients connect their wearables to oracles that push heart rate data on-chain. Doctors subscribe via apps, gaining access only with patient consent. The blockchain ensures immutability, while oracles handle off-chain real-time feeds.

**For Patients**  
- Register your profile and wearable device.  
- Grant access to specific doctors or apps.  
- Monitor your data sharing history and revoke permissions anytime.  
- Receive alerts if anomalies are detected (e.g., irregular heart rate).  

**For Doctors/Apps**  
- Subscribe to a patient's data feed with their approval.  
- Receive real-time updates and historical queries.  
- Integrate with existing apps via APIs that query the blockchain.  
- Get notified of critical events for proactive care.  

**For Oracle Providers**  
- Feed verified heart rate data from devices to the blockchain.  
- Earn tokens for reliable data provision.  
- Use verification contracts to prove data accuracy.  

Boom! Secure, real-time health monitoring without big tech intermediaries.

## 📜 Smart Contracts Overview

The project is built around 8 Clarity smart contracts for modularity, security, and scalability:  

1. **UserRegistry.clar**: Handles registration of patients and doctors, storing profiles and public keys for encryption.  
2. **DeviceRegistry.clar**: Registers wearable devices, linking them to patient principals and validating device IDs.  
3. **DataOracle.clar**: Receives real-time heart rate data from external oracles, timestamps it, and emits events for listeners.  
4. **AccessControl.clar**: Manages permissions—patients grant/revoke access to doctors via ACLs (Access Control Lists).  
5. **AnomalyDetector.clar**: Analyzes incoming data for abnormalities (e.g., thresholds for tachycardia) and triggers alerts.  
6. **DataStorage.clar**: Stores encrypted heart rate history as hashes, allowing zero-knowledge proofs for verification.  
7. **SubscriptionManager.clar**: Facilitates doctor subscriptions, handling consents and real-time feed integrations.  
8. **TokenIncentive.clar**: Manages a native token for rewarding oracle providers and optional patient data-sharing incentives.  

These contracts interact via traits for loose coupling—e.g., DataOracle calls AnomalyDetector on new data, and AccessControl gates all reads. Deploy them on Stacks for Bitcoin-secured transactions!