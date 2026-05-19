const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL || "http://localhost:4000";

export type ProvisionUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  password?: string;
  groupName: string;
  roleName: string;
};

export async function provisionUser(input: ProvisionUserInput) {
  const response = await fetch(`${BFF_URL}/api/admin/users/provision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || "No se pudo provisionar el usuario");
  }

  return data;
}