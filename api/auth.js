// api/auth.js
import admin from "firebase-admin";

// Initialize Firebase Admin (reuse from middleware if available)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  // CORS setup
  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.ALLOWED_ORIGIN || "https://grasshoppersolutions.online",
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, email, password, name, phone, uid } = req.body;

  try {
    switch (action) {
      case "register":
        // Create new user
        const newUser = await admin.auth().createUser({
          email,
          password,
          displayName: name,
          phoneNumber: phone || null,
        });

        // Store additional user data in Firestore
        await admin
          .firestore()
          .collection("users")
          .doc(newUser.uid)
          .set({
            email,
            name,
            phone: phone || null,
            tier: "free",
            // requestCount: 0,
            // maxRequests: 50,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastReset: admin.firestore.FieldValue.serverTimestamp(),
          });

        // Create custom token for client
        const token = await admin.auth().createCustomToken(newUser.uid);

        return res.status(201).json({
          success: true,
          message: "Usuario registrado exitosamente",
          token,
          user: {
            uid: newUser.uid,
            email: newUser.email,
            name: name,
          },
        });

      case "verify-token":
        // Verify ID token from client
        const decodedToken = await admin.auth().verifyIdToken(req.body.token);

        // Get user data from Firestore
        const userDoc = await admin
          .firestore()
          .collection("users")
          .doc(decodedToken.uid)
          .get();

        const userData = userDoc.data();

        return res.status(200).json({
          success: true,
          user: {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: decodedToken.name || userData?.name,
            tier: userData?.tier || "free",
            // requestCount: userData?.requestCount || 0,
            // maxRequests: userData?.maxRequests || 50,
          },
        });

      case "send-password-reset":
        // Generate password reset link
        const resetLink = await admin.auth().generatePasswordResetLink(email);

        // In production, you'd send this via email service (SendGrid, etc.)
        // For now, we'll return it (NOT recommended for production)
        console.log(`Password reset link for ${email}: ${resetLink}`);

        return res.status(200).json({
          success: true,
          message: "Se ha enviado un enlace de recuperación a tu correo",
          // Remove this in production:
          resetLink: resetLink,
        });

      case "delete-user":
        // Delete user account
        await admin.auth().deleteUser(uid);
        await admin.firestore().collection("users").doc(uid).delete();

        return res.status(200).json({
          success: true,
          message: "Cuenta eliminada exitosamente",
        });

      default:
        return res.status(400).json({ error: "Acción no válida" });
    }
  } catch (error) {
    console.error("Auth error:", error);

    // Handle specific Firebase errors
    if (error.code === "auth/email-already-exists") {
      return res.status(400).json({ error: "Este correo ya está registrado" });
    }
    if (error.code === "auth/invalid-email") {
      return res.status(400).json({ error: "Correo electrónico inválido" });
    }
    if (error.code === "auth/weak-password") {
      return res
        .status(400)
        .json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }
    if (error.code === "auth/user-not-found") {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(500).json({
      error: "Error en el servidor",
      details: error.message,
    });
  }
}
