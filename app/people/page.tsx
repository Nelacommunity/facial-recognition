import { PeopleList } from "../../components/faces/PeopleList";

export default function People() {
  return (
    <main>
      <h1>People</h1>
      <p>Enrolled profiles. Deleting a person also deletes their face data and history.</p>
      <PeopleList />
    </main>
  );
}
